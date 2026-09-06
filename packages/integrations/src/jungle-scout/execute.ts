import {
  authorizeAttempt,
  finalizeAttempt,
  markDispatching,
  utcBudgetDay,
  type Pool,
} from "@forge-ops/db";
import { JS_ENDPOINTS, type JsEndpointName } from "./endpoints.ts";
import { requestFingerprint } from "./fingerprint.ts";
import type { JsTransport } from "./transport.ts";

export type JsQueryRequest = {
  endpoint: JsEndpointName;
  marketplace: "us";
  query: unknown;
  period?: unknown;
  filters?: unknown;
  sort?: unknown;
  pagination?: unknown;
  accountScope: string;
  wireLimit: number;
  budgetDay?: string;
};

export type JsQueryResult =
  | { kind: "cache"; body: unknown; fingerprint: string }
  | { kind: "succeeded"; body: unknown; fingerprint: string; attemptId: string }
  | { kind: "budget_blocked"; fingerprint: string }
  | { kind: "already_handled"; reason: string; fingerprint: string }
  | { kind: "http_failed"; status: number; fingerprint: string }
  | { kind: "outcome_unknown"; fingerprint: string }
  | { kind: "denied"; fingerprint: string }
  | { kind: "db_unavailable"; fingerprint: string };

const MAX_TRIES = 3;
const inflight = new Map<string, Promise<JsQueryResult>>();

export async function executeJsQuery(
  pool: Pool,
  transport: JsTransport,
  request: JsQueryRequest,
): Promise<JsQueryResult> {
  const spec = JS_ENDPOINTS[request.endpoint];
  const fingerprint = requestFingerprint({
    provider: "junglescout",
    accountScope: request.accountScope,
    endpoint: request.endpoint,
    method: spec.method,
    marketplace: request.marketplace,
    normalizedQuery: request.query,
    period: request.period ?? null,
    filters: request.filters ?? null,
    sort: request.sort ?? null,
    pagination: request.pagination ?? null,
  });
  const existing = inflight.get(fingerprint);
  if (existing) return existing;
  const pending = runJsQuery(pool, transport, request, spec, fingerprint);
  inflight.set(fingerprint, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(fingerprint);
  }
}

async function runJsQuery(
  pool: Pool,
  transport: JsTransport,
  request: JsQueryRequest,
  spec: (typeof JS_ENDPOINTS)[JsEndpointName],
  fingerprint: string,
): Promise<JsQueryResult> {
  const day = request.budgetDay ?? (await utcBudgetDay());

  for (let tryNo = 0; tryNo < MAX_TRIES; tryNo++) {
    let client;
    try {
      client = await pool.connect();
    } catch {
      return { kind: "db_unavailable", fingerprint };
    }
    let decision;
    try {
      await client.query("BEGIN");
      decision = await authorizeAttempt(client, {
        fingerprint,
        provider: "junglescout",
        endpoint: request.endpoint,
        budgetDay: day,
        wireLimit: request.wireLimit,
      });
      if (decision.kind === "authorized") {
        await markDispatching(client, decision.attemptId);
      }
      await client.query("COMMIT");
    } catch {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      client.release();
      return { kind: "db_unavailable", fingerprint };
    }
    client.release();


    if (decision.kind === "budget_blocked") return { kind: "budget_blocked", fingerprint };
    if (decision.kind === "already_handled") {
      if (decision.reason === "cache" || decision.reason === "succeeded") {
        const cached = await pool.query<{ body: unknown }>(`SELECT body FROM api_cache WHERE fingerprint = $1`, [
          fingerprint,
        ]);
        if (cached.rows[0]) return { kind: "cache", body: cached.rows[0].body, fingerprint };
      }
      return { kind: "already_handled", reason: decision.reason, fingerprint };
    }

    let wire: { status: number; body: unknown };
    try {
      wire = await transport.send({
        path: spec.path,
        method: spec.method,
        body: spec.method === "POST" ? { data: { type: spec.type, attributes: request.query } } : undefined,
      });
    } catch {
      const fail = await pool.connect();
      try {
        await fail.query("BEGIN");
        await finalizeAttempt(fail, {
          attemptId: decision.attemptId,
          budgetDay: day,
          fingerprint,
          status: "outcome_unknown",
          httpStatus: null,
        });
        await fail.query("COMMIT");
      } catch {
        try {
          await fail.query("ROLLBACK");
        } catch {
          /* ignore */
        }
      } finally {
        fail.release();
      }
      return { kind: "denied", fingerprint };
    }

    const retryable = wire.status === 429 || wire.status >= 500;
    const ok = wire.status >= 200 && wire.status < 300;
    const fin = await pool.connect();
    try {
      await fin.query("BEGIN");
      await finalizeAttempt(fin, {
        attemptId: decision.attemptId,
        budgetDay: day,
        fingerprint,
        status: ok ? "succeeded" : "http_failed",
        httpStatus: wire.status,
        cacheBody: ok ? wire.body : undefined,
      });
      await fin.query("COMMIT");
    } catch {
      try {
        await fin.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      fin.release();
      return { kind: "outcome_unknown", fingerprint };
    }
    fin.release();

    if (ok) return { kind: "succeeded", body: wire.body, fingerprint, attemptId: decision.attemptId };
    if (!retryable) return { kind: "http_failed", status: wire.status, fingerprint };
  }
  return { kind: "http_failed", status: 0, fingerprint };
}
