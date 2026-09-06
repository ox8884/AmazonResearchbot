import { createPool, recoverDispatchingAttempts } from "@forge-ops/db";
import { evaluateNiche, unknown, type Evidence, type NicheInput, type SettingsSnapshot, type Stage } from "@forge-ops/domain";
import { executeJsQuery } from "@forge-ops/integrations/jungle-scout/execute";
import { resolveTransport } from "@forge-ops/integrations/jungle-scout/transport";
import { PgBoss, type Job } from "pg-boss";
const JOB_ADVANCE = "candidate.advance";

type AdvanceJob = { candidateId: string; stage: string; inputVersion: number };

const appEnv = process.env.APP_ENV === "production" ? "production" : "development";
if (appEnv === "production") {
  throw new Error("This worker binary refuses production. Oracle systemd worker only.");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL missing");

const pool = createPool(databaseUrl);
const identity = await pool.query(
  `SELECT environment FROM deployment_identity WHERE environment = 'development'`,
);
if ((identity.rowCount ?? 0) === 0) {
  throw new Error("development identity missing");
}

const boss = new PgBoss({
  connectionString: databaseUrl,
  supervise: true,
  schedule: false,
  migrate: false,
});
await boss.start();
await recoverDispatchingAttempts(pool);
await boss.createQueue(JOB_ADVANCE);

await boss.work<AdvanceJob>(JOB_ADVANCE, { localConcurrency: 4, batchSize: 1 }, async (jobs: Job<AdvanceJob>[]) => {
  const job = jobs[0];
  if (!job) return;
  await advance(job.data);
});

async function currentSettings(): Promise<SettingsSnapshot> {
  const row = await pool.query<{ snapshot: SettingsSnapshot }>(
    `SELECT snapshot FROM settings_versions ORDER BY version DESC LIMIT 1`,
  );
  const snapshot = row.rows[0]?.snapshot;
  if (!snapshot) throw new Error("settings missing");
  return snapshot;
}

async function advance(data: AdvanceJob): Promise<void> {
  const client = await pool.connect();
  let stageAfter: Stage | null = null;
  let settings: SettingsSnapshot;
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      id: string;
      stage: Stage;
      blocked_reason: string | null;
      input_version: number;
    }>(`SELECT id, stage, blocked_reason, input_version FROM candidates WHERE id = $1 FOR UPDATE`, [
      data.candidateId,
    ]);
    const candidate = found.rows[0];
    if (!candidate) {
      await client.query("COMMIT");
      return;
    }
    if (candidate.blocked_reason === "web_session") {
      await client.query("COMMIT");
      return;
    }
    settings = await currentSettings();
    if (candidate.stage === "imported" || data.stage === "imported") {
      await client.query(`UPDATE candidates SET stage = 'screening', last_progress_at = now() WHERE id = $1`, [
        candidate.id,
      ]);
      await client.query(
        `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
         VALUES ($1,'screening',$2,'{}'::jsonb)
         ON CONFLICT (candidate_id, stage, input_version) DO NOTHING`,
        [candidate.id, candidate.input_version],
      );
      const ev = await client.query<{
        field: string;
        kind: string;
        value_text: string | null;
        reason: string | null;
        source_id: string | null;
        observed_at: Date | null;
      }>(`SELECT field, kind, value_text, reason, source_id, observed_at FROM evidence WHERE candidate_id = $1`, [
        candidate.id,
      ]);
      const nicheInput: NicheInput = {
        review700Count: evidenceNumber(ev.rows, "review_700_count"),
        review2000Count: evidenceNumber(ev.rows, "review_2000_count"),
        topPriceUsd: evidenceText(ev.rows, "top_price"),
        monthlyRevenueCompetitorCount: evidenceNumber(ev.rows, "monthly_revenue_competitors"),
        standardSize: evidenceBool(ev.rows, "standard_size"),
        differentiation: evidenceBool(ev.rows, "differentiation"),
      };
      const assessment = evaluateNiche(nicheInput, settings);
      await client.query(
        `INSERT INTO evaluations (candidate_id, settings_version, kind, outcome, payload)
         VALUES ($1, (SELECT max(version) FROM settings_versions), 'niche', $2, $3::jsonb)`,
        [candidate.id, assessment.outcome, JSON.stringify(assessment)],
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
    if (stageAfter === "api_validation" && settings.jsDailyWireCap <= 0) {
      await client.query(
        `UPDATE candidates SET blocked_reason = 'budget', last_progress_at = now() WHERE id = $1`,
        [candidate.id],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (stageAfter === "api_validation" && settings!.jsDailyWireCap > 0) {
    const result = await executeJsQuery(pool, resolveTransport(process.env), {
      endpoint: "product_database_query",
      marketplace: "us",
      query: { keyword: data.candidateId },
      accountScope: "local",
      wireLimit: settings!.jsDailyWireCap,
    });
    if (result.kind === "budget_blocked") {
      await pool.query(`UPDATE candidates SET blocked_reason = 'budget', last_progress_at = now() WHERE id = $1`, [
        data.candidateId,
      ]);
    }
  }
}

type EvidenceRow = {
  field: string;
  kind: string;
  value_text: string | null;
  reason: string | null;
  source_id: string | null;
  observed_at: Date | null;
};

function evidenceNumber(rows: EvidenceRow[], field: string): Evidence<number> {
  const row = rows.find((r) => r.field === field);
  if (!row || row.kind === "unknown" || row.value_text == null) {
    return unknown(row?.reason ?? "missing", row?.source_id ?? null);
  }
  if (row.kind !== "measured" && row.kind !== "estimate" && row.kind !== "quote") {
    return unknown("bad kind", row.source_id);
  }
  return {
    kind: row.kind,
    value: Number(row.value_text),
    sourceId: row.source_id ?? "",
    observedAt: row.observed_at?.toISOString() ?? "",
  };
}

function evidenceText(rows: EvidenceRow[], field: string): Evidence<string> {
  const row = rows.find((r) => r.field === field);
  if (!row || row.kind === "unknown" || row.value_text == null) {
    return unknown(row?.reason ?? "missing", row?.source_id ?? null);
  }
  if (row.kind !== "measured" && row.kind !== "estimate" && row.kind !== "quote") {
    return unknown("bad kind", row.source_id);
  }
  return {
    kind: row.kind,
    value: row.value_text,
    sourceId: row.source_id ?? "",
    observedAt: row.observed_at?.toISOString() ?? "",
  };
}

function evidenceBool(rows: EvidenceRow[], field: string): Evidence<boolean> {
  const text = evidenceText(rows, field);
  if (text.kind === "unknown") return text;
  return { ...text, value: text.value === "true" || text.value === "1" };
}

console.log("worker listening for candidate.advance");

process.on("SIGTERM", async () => {
  await boss.stop({ graceful: true, timeout: 20000 });
  await pool.end();
  process.exit(0);
});
