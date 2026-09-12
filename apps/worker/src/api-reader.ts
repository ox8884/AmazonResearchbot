import type { Pool } from "@forge-ops/db";
import {
  executeJsQuery,
  type JsQueryResult,
} from "@forge-ops/integrations/jungle-scout/execute";
import type { JsTransport } from "@forge-ops/integrations/jungle-scout/transport";
import type { JungleScoutRequest } from "@forge-ops/integrations/jungle-scout/requests";
import {
  persistOfficialSource,
  type SourceCapture,
} from "./api-source-store.ts";
import type { ApiValidationContext } from "./api-validation-store.ts";
export type ApiReadResult =
  | { kind: "source"; body: unknown; source: SourceCapture }
  | { kind: "deferred"; retryAt: Date }
  | {
      kind: "wait";
      blockedReason:
        | "budget"
        | "credential"
        | "external_outcome_unknown"
        | "provider_unavailable";
    };
export type ApiReaderContext = {
  pool: Pool;
  transport: JsTransport;
  context: ApiValidationContext;
};
export async function readOfficialSource(
  options: ApiReaderContext,
  request: JungleScoutRequest,
): Promise<ApiReadResult> {
  const { pool, transport, context } = options;
  const result = await executeJsQuery(pool, transport, {
    endpoint: request.endpoint,
    marketplace: "us",
    query: request.body?.data.attributes ?? null,
    parameters: request.query,
    accountScope: context.accountScope,
    wireLimit: context.snapshot.jsDailyWireCap,
  });
  if (result.kind !== "cache" && result.kind !== "succeeded")
    return waitReason(pool, result, context.snapshot.jsDailyWireCap);
  const source = await persistOfficialSource({
    pool,
    context,
    endpoint: request.endpoint,
    fingerprint: result.fingerprint,
    body: result.body,
  });
  return { kind: "source", body: result.body, source };
}
async function waitReason(
  pool: Pool,
  result: Exclude<
    JsQueryResult,
    { readonly kind: "cache" } | { readonly kind: "succeeded" }
  >,
  wireCap: number,
): Promise<Exclude<ApiReadResult, { kind: "source" }>> {
  switch (result.kind) {
    case "deferred":
      return { kind: "deferred", retryAt: result.retryAt };
    case "budget_blocked":
      return { kind: "wait", blockedReason: "budget" };
    case "outcome_unknown":
      return { kind: "wait", blockedReason: "external_outcome_unknown" };
    case "http_failed":
      return { kind: "wait", blockedReason: "provider_unavailable" };
    case "already_handled":
      return result.reason === "unknown" || result.reason === "in_flight"
        ? { kind: "wait", blockedReason: "external_outcome_unknown" }
        : { kind: "wait", blockedReason: "provider_unavailable" };
    case "denied": {
      const latest = await pool.query<{ status: string }>(
        `SELECT a.status FROM api_attempts a JOIN api_operations o ON o.id=a.operation_id
         WHERE o.fingerprint=$1 ORDER BY a.created_at DESC LIMIT 1`,
        [result.fingerprint],
      );
      return {
        kind: "wait",
        blockedReason:
          latest.rows[0]?.status === "outcome_unknown" ||
          latest.rows[0]?.status === "dispatching"
            ? "external_outcome_unknown"
            : wireCap <= 0
              ? "budget"
              : "credential",
      };
    }
    case "db_unavailable":
      throw new Error("api validation database unavailable");
    default:
      return assertNever(result);
  }
}

function assertNever(value: never): never {
  void value;
  throw new Error("unexpected api validation result");
}
