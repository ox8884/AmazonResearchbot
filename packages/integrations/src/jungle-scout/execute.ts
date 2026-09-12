import type { Pool } from "@forge-ops/db";
import { authorizeDispatch, finalizeDispatch } from "./dispatch.ts";
import { JS_ENDPOINTS, type JsEndpointName } from "./endpoints.ts";
import { requestFingerprint } from "./fingerprint.ts";
import { retryNotBefore } from "./retry-parser.ts";
import type { JsTransport } from "./transport.ts";

export type JsQueryRequest = {
  endpoint: JsEndpointName;
  marketplace: "us";
  query: unknown;
  parameters?: Readonly<Record<string, string>>;
  period?: unknown;
  filters?: unknown;
  sort?: unknown;
  pagination?: unknown;
  accountScope: string;
  wireLimit: number;
  testDispatchAt?: Date;
  testResponseReceivedAt?: Date;
};

export type JsQueryResult =
  | { kind: "cache"; body: unknown; fingerprint: string }
  | { kind: "succeeded"; body: unknown; fingerprint: string; attemptId: string }
  | { kind: "budget_blocked"; fingerprint: string }
  | {
      kind: "deferred";
      reason: "rate_limit" | "retry";
      retryAt: Date;
      fingerprint: string;
    }
  | { kind: "already_handled"; reason: string; fingerprint: string }
  | { kind: "http_failed"; status: number; fingerprint: string }
  | { kind: "outcome_unknown"; fingerprint: string }
  | { kind: "denied"; fingerprint: string }
  | { kind: "db_unavailable"; fingerprint: string };

type ExecutionRequest = JsQueryRequest & {
  readonly credentialRevision?: string;
};

const inflight = new Map<string, Promise<JsQueryResult>>();

export async function executeJsQuery(
  pool: Pool,
  transport: JsTransport,
  request: JsQueryRequest,
): Promise<JsQueryResult> {
  const spec = JS_ENDPOINTS[request.endpoint];
  const accountScope = transport.accountScope ?? request.accountScope;
  const fingerprint = requestFingerprint({
    provider: "junglescout",
    accountScope,
    endpoint: request.endpoint,
    method: spec.method,
    marketplace: request.marketplace,
    normalizedQuery: request.parameters
      ? { body: request.query, parameters: request.parameters }
      : request.query,
    period: request.period ?? null,
    filters: request.filters ?? null,
    sort: request.sort ?? null,
    pagination: request.pagination ?? null,
  });
  if (transport.kind === "disabled") {
    try {
      const cached = await pool.query<{ body: unknown }>(
        "SELECT body FROM api_cache WHERE fingerprint=$1 AND stored_at + ttl_hours * interval '1 hour' > now()",
        [fingerprint],
      );
      return cached.rows[0]
        ? { kind: "cache", body: cached.rows[0].body, fingerprint }
        : { kind: "denied", fingerprint };
    } catch {
      return { kind: "db_unavailable", fingerprint };
    }
  }
  const existing = inflight.get(fingerprint);
  if (existing) return existing;
  const pending = runJsQuery(
    pool,
    transport,
    {
      ...request,
      accountScope,
      credentialRevision: transport.credentialRevision,
    },
    spec,
    fingerprint,
  );
  inflight.set(fingerprint, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(fingerprint);
  }
}

async function runJsQuery(
  pool: Pool,
  transport: Extract<JsTransport, { kind: "ready" }>,
  request: ExecutionRequest,
  spec: (typeof JS_ENDPOINTS)[JsEndpointName],
  fingerprint: string,
): Promise<JsQueryResult> {
  const authorized = await authorizeDispatch(pool, {
    fingerprint,
    endpoint: request.endpoint,
    accountScope: request.accountScope,
    wireLimit: request.wireLimit,
    testDispatchAt: request.testDispatchAt,
    credentialRevision: request.credentialRevision,
  });
  if (authorized === null) return { kind: "db_unavailable", fingerprint };
  if (authorized.kind === "budget_blocked")
    return { kind: "budget_blocked", fingerprint };
  if (authorized.kind === "deferred") {
    return {
      kind: "deferred",
      reason: authorized.reason,
      retryAt: authorized.retryAt,
      fingerprint,
    };
  }
  if (authorized.kind === "already_handled") {
    if (authorized.reason === "cache" || authorized.reason === "succeeded") {
      const cached = await pool.query<{ body: unknown }>(
        "SELECT body FROM api_cache WHERE fingerprint = $1 AND stored_at + ttl_hours * interval '1 hour' > clock_timestamp()",
        [fingerprint],
      );
      const cachedBody = cached.rows[0]?.body;
      if (cachedBody !== undefined)
        return { kind: "cache", body: cachedBody, fingerprint };
    }
    return { kind: "already_handled", reason: authorized.reason, fingerprint };
  }

  let wire;
  try {
    wire = await transport.send({
      path:
        spec.path +
        "?" +
        new URLSearchParams({
          ...request.parameters,
          marketplace: request.marketplace,
        }).toString(),
      method: spec.method,
      body:
        spec.method === "POST"
          ? { data: { type: spec.type, attributes: request.query } }
          : undefined,
    });
  } catch {
    await finalizeDispatch(pool, {
      attemptId: authorized.attemptId,
      budgetDay: authorized.budgetDay,
      fingerprint,
      status: "outcome_unknown",
      httpStatus: null,
    });
    return { kind: "outcome_unknown", fingerprint };
  }

  const succeeded = wire.status >= 200 && wire.status < 300;
  const responseReceivedAt =
    request.testResponseReceivedAt ?? request.testDispatchAt ?? new Date();
  if (Number.isNaN(responseReceivedAt.getTime()))
    return { kind: "outcome_unknown", fingerprint };
  const retryAt =
    wire.status === 429 || wire.status >= 500
      ? retryNotBefore({
          retryNumber: authorized.attemptNumber,
          retryAfter: wire.retryAfter,
          body: wire.body,
          now: responseReceivedAt,
        })
      : undefined;
  const finalized = await finalizeDispatch(pool, {
    attemptId: authorized.attemptId,
    budgetDay: authorized.budgetDay,
    fingerprint,
    status: succeeded ? "succeeded" : "http_failed",
    httpStatus: wire.status,
    cacheBody: succeeded ? wire.body : undefined,
    retryAt,
  });
  if (finalized === null) return { kind: "outcome_unknown", fingerprint };
  if (finalized.kind === "retry_scheduled") {
    return {
      kind: "deferred",
      reason: "retry",
      retryAt: finalized.retryAt,
      fingerprint,
    };
  }
  if (succeeded)
    return {
      kind: "succeeded",
      body: wire.body,
      fingerprint,
      attemptId: authorized.attemptId,
    };
  return { kind: "http_failed", status: wire.status, fingerprint };
}
