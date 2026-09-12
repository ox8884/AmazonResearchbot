import type { QueryConnection } from './rfq-state.ts';

export type PackageContext = {
  readonly id: string; readonly stage: 'api_validation'; readonly input_version: number;
  readonly settings_version: number; readonly asin: string; readonly spec_id: null;
};
export async function lockPackageContext(db: QueryConnection, candidateId: string): Promise<PackageContext | null> {
  const row = (await db.query<PackageContext>(`
    SELECT c.id,c.stage,c.input_version,v.version AS settings_version,e.detail->>'representativeAsin' AS asin,NULL::uuid AS spec_id
    FROM candidates c
    JOIN LATERAL (SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
    JOIN candidate_events e ON e.candidate_id=c.id AND e.input_version=c.input_version AND e.stage='api_validation'
    WHERE c.id=$1 AND c.marketplace='us' AND c.stage='api_validation' AND e.detail->>'representativeAsin' ~ '^[A-Z0-9]{10}$'
    FOR UPDATE OF c`, [candidateId])).rows[0];
  return row ?? null;
}
