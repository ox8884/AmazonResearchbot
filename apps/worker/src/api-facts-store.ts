import type { Pool } from "@forge-ops/db";
import type { Evidence } from "@forge-ops/domain";
import type { ApiValidationContext } from "./api-validation-store.ts";
export type ApiFact = {
  readonly field: string;
  readonly evidence: Evidence<number | string>;
};
export async function storeApiFacts(
  pool: Pool,
  context: ApiValidationContext,
  facts: readonly ApiFact[],
): Promise<boolean> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const row = (
      await db.query<{ stage: string; input_version: number }>(
        "SELECT stage,input_version FROM candidates WHERE id=$1 FOR UPDATE",
        [context.candidateId],
      )
    ).rows[0];
    const current = (
      await db.query<{ version: number }>(
        "SELECT max(version)::int AS version FROM settings_versions",
      )
    ).rows[0];
    if (
      row?.stage !== "api_validation" ||
      row.input_version !== context.inputVersion ||
      current?.version !== context.settingsVersion
    ) {
      await db.query("COMMIT");
      return false;
    }
    // One statement for the batch (a catalog lookup stores ten facts per product). DISTINCT keeps a
    // repeated fact to one row, as inserting them one at a time behind NOT EXISTS did.
    const evidence = facts.map((fact) => fact.evidence);
    if (facts.length)
      await db.query(
        `INSERT INTO evidence(candidate_id,field,kind,value_numeric,value_text,source_id,observed_at,reason,input_version,settings_version)
       SELECT DISTINCT $1::uuid,f.field,f.kind,f.value_numeric,f.value_text,f.source_id,f.observed_at,f.reason,$9::int,$10::int
       FROM unnest($2::text[],$3::text[],$4::numeric[],$5::text[],$6::text[],$7::timestamptz[],$8::text[])
         AS f(field,kind,value_numeric,value_text,source_id,observed_at,reason)
       WHERE NOT EXISTS(SELECT 1 FROM evidence e WHERE e.candidate_id=$1 AND e.field=f.field AND e.kind=f.kind AND e.value_numeric IS NOT DISTINCT FROM f.value_numeric AND e.value_text IS NOT DISTINCT FROM f.value_text AND e.source_id IS NOT DISTINCT FROM f.source_id AND e.observed_at IS NOT DISTINCT FROM f.observed_at AND e.reason IS NOT DISTINCT FROM f.reason AND e.input_version=$9 AND e.settings_version=$10)`,
        [
          context.candidateId,
          facts.map((fact) => fact.field),
          evidence.map((e) => e.kind),
          evidence.map((e) => (e.kind !== "unknown" && typeof e.value === "number" ? e.value : null)),
          evidence.map((e) => (e.kind !== "unknown" && typeof e.value === "string" ? e.value : null)),
          evidence.map((e) => e.sourceId),
          evidence.map((e) => e.observedAt),
          evidence.map((e) => (e.kind === "unknown" ? e.reason : null)),
          context.inputVersion,
          context.settingsVersion,
        ],
      );
    await db.query("COMMIT");
    return true;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
