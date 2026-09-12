import type { Pool } from "@forge-ops/db";
import type { JsEndpointName } from "@forge-ops/integrations/jungle-scout/endpoints";
import { exactPayloadHash } from "@forge-ops/security";
export type SourceCapture = {
  readonly sourceId: string;
  readonly observedAt: string | null;
};
type CaptureRow = { id: string; observed_at: Date | null };
export async function persistOfficialSource(input: {
  readonly pool: Pool;
  readonly context: {
    candidateId: string;
    inputVersion: number;
    settingsVersion: number;
  };
  readonly endpoint: JsEndpointName;
  readonly fingerprint: string;
  readonly body: unknown;
}): Promise<SourceCapture> {
  const bodySha256 = exactPayloadHash(input.body);
  const cache = await input.pool.query<{ stored_at: Date; body: unknown }>(
    "SELECT stored_at,body FROM api_cache WHERE fingerprint=$1",
    [input.fingerprint],
  );
  const cached = cache.rows[0];
  const observedAt =
    cached && exactPayloadHash(cached.body) === bodySha256
      ? cached.stored_at
      : null;
  const params = [
    input.context.candidateId,
    input.context.inputVersion,
    input.context.settingsVersion,
    input.endpoint,
    input.fingerprint,
    bodySha256,
    observedAt,
  ];
  const inserted = await input.pool.query<CaptureRow>(
    `INSERT INTO api_validation_sources(candidate_id,input_version,settings_version,endpoint,request_fingerprint,body_sha256,observed_at,raw_body)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT(candidate_id,input_version,settings_version,endpoint,request_fingerprint,body_sha256,observed_at) DO NOTHING RETURNING id,observed_at`,
    [...params, JSON.stringify(input.body)],
  );
  const row =
    inserted.rows[0] ??
    (
      await input.pool.query<CaptureRow>(
        `SELECT id,observed_at FROM api_validation_sources WHERE candidate_id=$1 AND input_version=$2 AND settings_version=$3 AND endpoint=$4 AND request_fingerprint=$5 AND body_sha256=$6 AND observed_at IS NOT DISTINCT FROM $7::timestamptz`,
        params,
      )
    ).rows[0];
  if (!row) throw new Error("API source retention failed");
  return {
    sourceId: `api-validation-source:${row.id}`,
    observedAt: row.observed_at?.toISOString() ?? null,
  };
}
