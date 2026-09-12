import type { PoolClient } from "pg";
type OperationDecision =
  | { readonly kind: "cache" }
  | { readonly kind: "blocked"; readonly reason: "unknown" | "in_flight" }
  | {
      readonly kind: "operation";
      readonly id: string;
      readonly status: string | null;
    };
export async function loadApiOperation(
  client: PoolClient,
  input: {
    fingerprint: string;
    provider: string;
    endpoint: string;
    credentialRevision?: string;
  },
): Promise<OperationDecision> {
  const cache = (
    await client.query<{ generation: number; fresh: boolean }>(
      "SELECT generation,stored_at+ttl_hours*interval '1 hour'>clock_timestamp() AS fresh FROM api_cache WHERE fingerprint=$1",
      [input.fingerprint],
    )
  ).rows[0];
  if (cache?.fresh) return { kind: "cache" };
  const unresolved = (
    await client.query<{ status: string }>(
      "SELECT a.status FROM api_attempts a JOIN api_operations o ON o.id=a.operation_id WHERE o.fingerprint=$1 AND a.status IN ('authorized','dispatching','outcome_unknown') ORDER BY CASE WHEN a.status='outcome_unknown' THEN 0 ELSE 1 END LIMIT 1",
      [input.fingerprint],
    )
  ).rows[0];
  if (unresolved)
    return {
      kind: "blocked",
      reason: unresolved.status === "outcome_unknown" ? "unknown" : "in_flight",
    };
  const latest = (
    await client.query<{
      id: string;
      generation: number;
      status: string | null;
      http_status: number | null;
      credential_revision: string | null;
    }>(
      `SELECT o.id,o.generation,o.credential_revision,a.status,a.http_status FROM api_operations o LEFT JOIN LATERAL (SELECT status,http_status FROM api_attempts WHERE operation_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON true WHERE o.fingerprint=$1 ORDER BY o.generation DESC LIMIT 1 FOR UPDATE OF o`,
      [input.fingerprint],
    )
  ).rows[0];
  const changedCredentials =
    latest?.status === "http_failed" &&
    (latest.http_status === 401 || latest.http_status === 403) &&
    latest.credential_revision !== null &&
    input.credentialRevision !== undefined &&
    latest.credential_revision !== input.credentialRevision;
  if (
    latest &&
    !changedCredentials &&
    !(latest.status === "succeeded" && cache?.generation === latest.generation)
  )
    return { kind: "operation", id: latest.id, status: latest.status };
  const inserted = await client.query<{ id: string }>(
    "INSERT INTO api_operations(fingerprint,provider,endpoint,generation) VALUES($1,$2,$3,$4) RETURNING id",
    [
      input.fingerprint,
      input.provider,
      input.endpoint,
      (latest?.generation ?? 0) + 1,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("API operation insert failed");
  return { kind: "operation", id, status: null };
}
