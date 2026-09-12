import { runCandidateAiWork } from "./ai-business.ts";
import type { AiTransport } from "@forge-ops/integrations/ai/transport";
import type { AiBusinessInput } from "@forge-ops/domain";
import { consumeOfficialValidation } from "./api-validation.ts";
import {readMarketSource} from '@forge-ops/integrations/amazon/market-source';
import type { Pool } from "@forge-ops/db";
import { evaluateNiche, readNicheEvidence, type StoredEvidence, type SettingsSnapshot, type Stage } from "@forge-ops/domain";
import type { JsTransport } from "@forge-ops/integrations/jungle-scout/transport";
import { PgBoss } from "pg-boss";

export type AdvanceJob = { candidateId: string; stage: string; inputVersion: number };

async function scheduleDeferredAdvance(pool: Pool, job: AdvanceJob, retryAt: Date): Promise<void> {
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    migrate: false,
    schedule: false,
    supervise: false,
  });
  await boss.start();
  try {
    await boss.upsert("candidate.advance", job, {
      singletonKey: `jungle-scout-retry:${job.candidateId}:${job.inputVersion}`,
      startAfter: retryAt,
    });
  } finally {
    await boss.stop({ graceful: false, timeout: 2_000 });
  }
}

async function currentSettings(pool: Pick<Pool, "query">): Promise<{ version: number; snapshot: SettingsSnapshot }> {
  const row = await pool.query<{ version: number; snapshot: SettingsSnapshot }>(
    "SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1",
  );
  const settings = row.rows[0];
  if (!settings) throw new Error("settings missing");
  return settings;
}

export async function advanceCandidate(pool: Pool, transport: JsTransport, data: AdvanceJob, ai?: {transport:AiTransport;encryptionKey:Buffer}): Promise<void> {
  const client = await pool.connect();
  let stageAfter: Stage | null = null;
  let settings: SettingsSnapshot | undefined;
  let keyword: string | undefined;
  let settingsVersion: number | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const found = await client.query<{
      id: string;
      stage: Stage;
      blocked_reason: string | null;
      input_version: number;
      keyword_display: string;
    }>(`SELECT id, stage, blocked_reason, input_version, keyword_display FROM candidates WHERE id = $1 FOR UPDATE`, [
      data.candidateId,
    ]);
    const candidate = found.rows[0];
    if (!candidate) {
      await client.query("COMMIT");
      return;
    }
    if (candidate.input_version !== data.inputVersion || candidate.stage !== data.stage || candidate.blocked_reason === "web_session") {
      await client.query("COMMIT");
      return;
    }
    keyword = candidate.keyword_display;
    const current = await currentSettings(client);
    settings = current.snapshot;
    settingsVersion = current.version;
    if (candidate.stage === "imported" || candidate.stage === "screening") {
      await client.query(`UPDATE candidates SET stage = 'screening', last_progress_at = now() WHERE id = $1`, [
        candidate.id,
      ]);
      await client.query(
        `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
         VALUES ($1,'screening',$2,'{}'::jsonb)
         ON CONFLICT (candidate_id, stage, input_version) DO NOTHING`,
        [candidate.id, candidate.input_version],
      );
      const ev = await client.query<StoredEvidence>(`SELECT DISTINCT ON (field) field, kind, value_text, value_numeric::text, reason, source_id, observed_at FROM evidence WHERE candidate_id = $1 ORDER BY field, created_at DESC, id DESC`, [
        candidate.id,
      ]);
      const nicheInput = readNicheEvidence(ev.rows);
      const assessment = evaluateNiche(nicheInput, settings);
      await client.query(
        `INSERT INTO evaluations (candidate_id, settings_version, kind, outcome, payload)
         VALUES ($1, (SELECT max(version) FROM settings_versions), 'niche', $2, $3::jsonb)`,
        [candidate.id, assessment.outcome, JSON.stringify({ inputVersion: candidate.input_version, assessment, input: nicheInput, evidenceBlock: null, sourceIds: [...new Set(ev.rows.map(row => row.source_id).filter((id): id is string => id !== null && id.trim() !== ""))] })],
      );
      if (assessment.outcome === "reject") {
        await client.query(`UPDATE candidates SET stage = 'rejected', last_progress_at = now() WHERE id = $1`, [
          candidate.id,
        ]);
      } else {
        await client.query(
          `UPDATE candidates SET stage = 'api_validation', last_progress_at = now() WHERE id = $1`,
          [candidate.id],
        );
        await client.query(
          `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
           VALUES ($1,'api_validation',$2,'{}'::jsonb)
           ON CONFLICT DO NOTHING`,
          [candidate.id, candidate.input_version],
        );
      }
    }
    const after = await client.query<{ stage: Stage }>(`SELECT stage FROM candidates WHERE id = $1`, [candidate.id]);
    stageAfter = after.rows[0]?.stage ?? null;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (stageAfter === "api_validation" && settings && settingsVersion !== undefined && keyword !== undefined) {
    const market=ai?await readMarketSource(pool,data.candidateId,ai.encryptionKey):null;
    const firstPageSource=market?.state==='captured'&&market.inputVersion===data.inputVersion&&market.settingsVersion===settingsVersion?market:null;
    await consumeOfficialValidation(
      pool,
      transport,
      {
        candidateId: data.candidateId,
        inputVersion: data.inputVersion,
        keyword,
        settingsVersion,
        snapshot: settings,
        accountScope: "local",
        ...(firstPageSource?{firstPageSource}:{}),
      },
      (retryAt) => scheduleDeferredAdvance(pool, { ...data, stage: "api_validation" }, retryAt),
    );
  }
  if(ai?.transport.kind==='ready'){
    const current=(await pool.query<{stage:string}>('SELECT stage FROM candidates WHERE id=$1',[data.candidateId])).rows[0];
    const roles:AiBusinessInput['role'][]=[];
    if(['imported','screening'].includes(data.stage))roles.push('normalize');
    if(current&&['api_validation','sourcing'].includes(current.stage))roles.push('niche_analysis');
    if(current?.stage==='sourcing')roles.push('sourcing_analysis');
    if(current&&['rfq_draft','awaiting_contact_approval'].includes(current.stage))roles.push('rfq_draft');
    for(const role of roles)await runCandidateAiWork(pool,data.candidateId,role,ai);
  }

}
