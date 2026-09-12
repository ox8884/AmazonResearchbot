import type { QueryConnection } from "./rfq-state.ts";

export type SourcingCandidate = {
  id: string; stage: "sourcing" | "rfq_draft" | "awaiting_contact_approval"; keyword_display: string; input_version: number; settings_version: number;
};
export type SourcingContext = SourcingCandidate & {
  spec_id: string; material: string; dimensions: string; packaging: string; requirements: string;
};
// Call inside a transaction after taking the forge.settings advisory lock.
export async function lockSourcingCandidate(db: QueryConnection, candidateId: string): Promise<SourcingCandidate | null> {
  const rows = await db.query<SourcingCandidate>(`
   SELECT c.id,c.stage,c.keyword_display,c.input_version,v.version AS settings_version
   FROM candidates c
   JOIN LATERAL (SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
   JOIN LATERAL (SELECT outcome,stale FROM evaluations WHERE candidate_id=c.id AND kind='api_validation'
     AND settings_version=v.version AND payload->>'inputVersion'=c.input_version::text
     ORDER BY created_at DESC,id DESC LIMIT 1) e ON e.outcome='pass' AND NOT e.stale
   WHERE c.id=$1 AND c.stage IN ('sourcing','rfq_draft','awaiting_contact_approval')
     AND (c.blocked_reason IS NULL OR c.blocked_reason='web_session')
   FOR UPDATE OF c`, [candidateId]);
  return rows.rows[0] ?? null;
}
export async function lockSourcingContext(db: QueryConnection, candidateId: string): Promise<SourcingContext | null> {
  const candidate = await lockSourcingCandidate(db, candidateId);
  if (!candidate) return null;
  const spec = (await db.query<Pick<SourcingContext, "spec_id" | "material" | "dimensions" | "packaging" | "requirements">>(
    "SELECT id AS spec_id,material,dimensions,packaging,requirements FROM spec_revisions WHERE candidate_id=$1 ORDER BY revision DESC LIMIT 1", [candidateId],
  )).rows[0];
  return spec ? { ...candidate, ...spec } : null;
}
