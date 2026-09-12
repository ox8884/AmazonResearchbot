import { evaluateNiche, unknown, readNicheEvidence, type StoredEvidence, type NicheAssessment, type NicheInput, type SettingsSnapshot } from "@forge-ops/domain";
import type { Pool } from "@forge-ops/db";
import type {MarketLeader} from './market-leader.ts';
import {isDeepStrictEqual} from 'node:util';
import type {FirstPageSource,FirstPageSales} from './first-page-sales.ts';

export type ApiValidationContext = {
  readonly candidateId: string;
  readonly keyword: string;
  readonly inputVersion: number;
  readonly settingsVersion: number;
  readonly snapshot: SettingsSnapshot;
  readonly accountScope: string;
  readonly firstPageSource?: FirstPageSource;
};

export type ApiValidationDecision = {
  readonly assessment: NicheAssessment;
  readonly input: NicheInput;
  readonly outcome: "pass" | "reject" | "hold";
  readonly evidenceBlock: string | null;
  readonly sourceIds: readonly string[];
  readonly marketLeader?: MarketLeader;
  readonly firstPageSales?: FirstPageSales;
};

export async function loadCanonicalNicheEvidence(pool: Pick<Pool,'query'>, candidateId: string): Promise<Pick<NicheInput, "topPriceUsd" | "standardSize" | "differentiation">> {
  const evidence = await pool.query<StoredEvidence>(
    `SELECT DISTINCT ON (e.field) e.field,e.kind,e.value_numeric::text,e.value_text,e.source_id,e.observed_at,e.reason
     FROM evidence e JOIN candidates c ON c.id=e.candidate_id
     WHERE e.candidate_id=$1 AND e.field IN ('top_price','standard_size','differentiation')
       AND (e.input_version IS NULL OR (e.input_version=c.input_version
         AND e.settings_version=(SELECT max(version) FROM settings_versions)))
     ORDER BY e.field,e.created_at DESC,e.id DESC`,
    [candidateId],
  );
  const input = readNicheEvidence(evidence.rows);
  return { topPriceUsd: input.topPriceUsd, standardSize: input.standardSize, differentiation: input.differentiation };
}

export async function applyApiValidationDecision(input: {
  readonly pool: Pool;
  readonly context: ApiValidationContext;
  readonly decision: ApiValidationDecision;
}): Promise<"pass" | "reject" | "hold" | "stale"> {
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const candidate = await client.query<{ stage: string; input_version: number }>("SELECT stage,input_version FROM candidates WHERE id=$1 FOR UPDATE", [input.context.candidateId]);
    const latest = await client.query<{ version: number }>("SELECT max(version)::int AS version FROM settings_versions");
    if (candidate.rows[0]?.stage !== "api_validation" || candidate.rows[0]?.input_version !== input.context.inputVersion || latest.rows[0]?.version !== input.context.settingsVersion) {
      await client.query("COMMIT");
      return "stale";
    }
    const current=await loadCanonicalNicheEvidence(client,input.context.candidateId);
    if(!isDeepStrictEqual(current.standardSize,input.decision.input.standardSize)||!isDeepStrictEqual(current.differentiation,input.decision.input.differentiation)){
      await client.query('COMMIT');return 'stale';
    }
    if(input.context.firstPageSource){
      const source=(await client.query<{result_id:string|null}>("SELECT result_id FROM browser_tasks WHERE candidate_id=$1 AND task_kind='amazon_search' ORDER BY created_at DESC,id DESC LIMIT 1",[input.context.candidateId])).rows[0];
      if(source?.result_id!==input.context.firstPageSource.receiptId){await client.query('COMMIT');return 'stale';}
    }
    let decision = input.decision;
    const representative = (await client.query<{ asin: string | null; has_spec: boolean }>(`
      SELECT (SELECT detail->>'representativeAsin' FROM candidate_events
        WHERE candidate_id=$1 AND input_version=$2 AND stage='api_validation') AS asin,
        EXISTS(SELECT 1 FROM spec_revisions WHERE candidate_id=$1) AS has_spec`,
      [input.context.candidateId,input.context.inputVersion])).rows[0];
    if (!representative?.asin && !representative?.has_spec && !decision.assessment.hardFail) {
      const leaderAsins = decision.marketLeader?.asins;
      const selected = leaderAsins && leaderAsins.kind !== 'unknown'
        && /^[A-Z0-9]{10}$/.test(leaderAsins.value)
        ? (await client.query<{ id: string }>(`
          INSERT INTO candidate_events(candidate_id,stage,input_version,detail)
          VALUES($1,'api_validation',$2,$3::jsonb)
          ON CONFLICT(candidate_id,stage,input_version) DO UPDATE
          SET detail=candidate_events.detail || EXCLUDED.detail
          WHERE COALESCE(candidate_events.detail->>'representativeAsin','')=''
          RETURNING id`, [input.context.candidateId,input.context.inputVersion,JSON.stringify({
            representativeAsin:leaderAsins.value,selectionMethod:'market_leader',
            selectionSettingsVersion:input.context.settingsVersion,selectionSourceId:leaderAsins.sourceId,
          })])).rows[0] : undefined;
      if (selected) {
        await client.query(`INSERT INTO evidence(candidate_id,field,kind,reason,source_id,input_version,settings_version)
          SELECT $1,field,'unknown','Representative product evidence needs confirmation',$2,$3,$4
          FROM unnest(ARRAY['standard_size','differentiation']) AS field`,
          [input.context.candidateId,'candidate-event:'+selected.id,input.context.inputVersion,input.context.settingsVersion]);
        await client.query('UPDATE evaluations SET stale=true WHERE candidate_id=$1',[input.context.candidateId]);
        await client.query("INSERT INTO audit_events(actor,action,target) VALUES('worker','representative_asin_auto_selected',$1)",[input.context.candidateId]);
      }
      const pending = unknown('Representative product evidence needs confirmation',selected?'candidate-event:'+selected.id:null);
      const nicheInput = {...decision.input,standardSize:pending,differentiation:pending};
      const assessment = evaluateNiche(nicheInput,input.context.snapshot);
      decision = {...decision,input:nicheInput,assessment,outcome:assessment.outcome==='reject'?'reject':'hold',
        evidenceBlock:decision.evidenceBlock ?? (selected?'REPRESENTATIVE_EVIDENCE_REQUIRED':'REPRESENTATIVE_SELECTION_REQUIRED')};
    }
    const payload = JSON.stringify({ inputVersion: input.context.inputVersion, assessment: decision.assessment, input: decision.input, evidenceBlock: decision.evidenceBlock, sourceIds: decision.sourceIds, firstPageSales:decision.firstPageSales });
    const leader=input.decision.marketLeader;
    if(leader){
      for(const [field,value] of [['top_price',leader.price],['api_market_leader_family',leader.family],['api_market_leader_asins',leader.asins],['api_market_leader_period',leader.period]] as const){
        await client.query(`INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at,reason,input_version,settings_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[input.context.candidateId,field,value.kind,value.kind==='unknown'?null:value.value,value.sourceId,value.observedAt,value.kind==='unknown'?value.reason:null,input.context.inputVersion,input.context.settingsVersion]);
      }
    }
    await client.query(
      `INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload)
       VALUES($1,$2,'api_validation',$3,$4::jsonb)`,
      [input.context.candidateId, input.context.settingsVersion, decision.outcome, payload],
    );
    if (decision.outcome === "pass") {
      await client.query("UPDATE candidates SET stage='sourcing',blocked_reason=NULL,last_progress_at=now() WHERE id=$1", [input.context.candidateId]);
    } else if (decision.outcome === "reject") {
      await client.query("UPDATE candidates SET stage='rejected',blocked_reason=NULL,last_progress_at=now() WHERE id=$1", [input.context.candidateId]);
    } else {
      await client.query("UPDATE candidates SET blocked_reason='evidence',last_progress_at=now() WHERE id=$1", [input.context.candidateId]);
    }
    await client.query("COMMIT");
    return decision.outcome;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function applyApiValidationWait(input: {
  readonly pool: Pool;
  readonly context: ApiValidationContext;
  readonly blockedReason: "budget" | "credential" | "external_outcome_unknown" | "provider_unavailable";
}): Promise<"blocked" | "stale"> {
  const result = await input.pool.query(
    `UPDATE candidates SET blocked_reason=$4,last_progress_at=now()
     WHERE id=$1 AND stage='api_validation' AND input_version=$2
       AND (SELECT max(version) FROM settings_versions)=$3`,
    [input.context.candidateId, input.context.inputVersion, input.context.settingsVersion, input.blockedReason],
  );
  return result.rowCount === 1 ? "blocked" : "stale";
}
