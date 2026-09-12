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
    for (const fact of facts) {
      const e = fact.evidence,
        numeric =
          e.kind !== "unknown" && typeof e.value === "number" ? e.value : null,
        text =
          e.kind !== "unknown" && typeof e.value === "string" ? e.value : null;
      await db.query(
        `INSERT INTO evidence(candidate_id,field,kind,value_numeric,value_text,source_id,observed_at,reason,input_version,settings_version)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE NOT EXISTS(SELECT 1 FROM evidence WHERE candidate_id=$1 AND field=$2 AND kind=$3 AND value_numeric IS NOT DISTINCT FROM $4::numeric AND value_text IS NOT DISTINCT FROM $5::text AND source_id IS NOT DISTINCT FROM $6::text AND observed_at IS NOT DISTINCT FROM $7::timestamptz AND reason IS NOT DISTINCT FROM $8::text AND input_version=$9 AND settings_version=$10)`,
        [
          context.candidateId,
          fact.field,
          e.kind,
          numeric,
          text,
          e.sourceId,
          e.observedAt,
          e.kind === "unknown" ? e.reason : null,
          context.inputVersion,
          context.settingsVersion,
        ],
      );
    }
    await db.query("COMMIT");
    return true;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
