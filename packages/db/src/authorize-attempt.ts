import { loadApiOperation } from "./api-operation.ts";
import type { Pool, PoolClient } from "pg";
import {
  clearRetry,
  loadPendingRetry,
  reserveJungleScoutRateLimit,
  scheduleRetry,
} from "./rate-retry.ts";

export type AttemptDecision =
  | {
      readonly kind: "authorized";
      readonly attemptId: string;
      readonly operationId: string;
      readonly budgetDay: string;
      readonly attemptNumber: number;
    }
  | { readonly kind: "budget_blocked" }
  | {
      readonly kind: "deferred";
      readonly reason: "rate_limit" | "retry";
      readonly retryAt: Date;
    }
  | {
      readonly kind: "already_handled";
      readonly reason:
        "cache" | "unknown" | "in_flight" | "succeeded" | "failed";
    };

export type AuthorizeInput = {
  readonly credentialRevision?: string;
  readonly fingerprint: string;
  readonly provider: string;
  readonly endpoint: string;
  readonly accountScope: string;
  readonly wireLimit: number;
  readonly testNow?: Date;
};

export type FinalizeDecision =
  | { readonly kind: "finalized" }
  | { readonly kind: "retry_scheduled"; readonly retryAt: Date }
  | { readonly kind: "unchanged" };

function validAttemptInput(
  input: AuthorizeInput,
  approvedLimit: unknown,
): approvedLimit is number {
  return (
    input.provider === "junglescout" &&
    input.accountScope.trim().length > 0 &&
    input.accountScope.length <= 256 &&
    typeof approvedLimit === "number" &&
    Number.isSafeInteger(approvedLimit) &&
    approvedLimit >= 0 &&
    Number.isSafeInteger(input.wireLimit) &&
    input.wireLimit >= 0
  );
}

export async function recoverDispatchingAttempts(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE api_attempts SET status = 'outcome_unknown', finished_at = now()
     WHERE status = 'dispatching'`,
  );
  return result.rowCount ?? 0;
}

export async function authorizeAttempt(
  client: PoolClient,
  input: AuthorizeInput,
): Promise<AttemptDecision> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('forge.settings'))",
  );
  const settings = await client.query<{ wire_limit: unknown }>(
    "SELECT snapshot->'jsDailyWireCap' AS wire_limit FROM settings_versions ORDER BY version DESC LIMIT 1",
  );
  const approvedLimit = settings.rows[0]?.wire_limit;
  if (!validAttemptInput(input, approvedLimit))
    return { kind: "budget_blocked" };

  await client.query(
    `SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`,
    [input.fingerprint],
  );
  const clock =
    input.testNow === undefined
      ? await client.query<{ dispatched_at: Date }>(
          "SELECT clock_timestamp() AS dispatched_at",
        )
      : null;
  const now = input.testNow ?? clock?.rows[0]?.dispatched_at;
  if (now === undefined || Number.isNaN(now.getTime()))
    return { kind: "budget_blocked" };
  const budgetDay = now.toISOString().slice(0, 10);
  const operation = await loadApiOperation(client, input);
  if (operation.kind === "cache")
    return { kind: "already_handled", reason: "cache" };
  if (operation.kind === "blocked")
    return { kind: "already_handled", reason: operation.reason };
  const operationId = operation.id;
  const status = operation.status;
  if (status === "succeeded")
    return { kind: "already_handled", reason: "succeeded" };
  const pendingRetry = await loadPendingRetry(client, operationId);
  if (status === "http_failed") {
    if (pendingRetry === null)
      return { kind: "already_handled", reason: "failed" };
    if (pendingRetry.retryAt > now) {
      return {
        kind: "deferred",
        reason: "retry",
        retryAt: pendingRetry.retryAt,
      };
    }
  }

  await client.query(
    `INSERT INTO budget_days (day_utc, wire_limit) VALUES ($1::date, $2)
     ON CONFLICT (day_utc) DO UPDATE SET wire_limit=EXCLUDED.wire_limit`,
    [budgetDay, approvedLimit],
  );
  const budget = await client.query<{
    reserved: number;
    consumed: number;
    wire_limit: number;
  }>(
    `SELECT reserved, consumed, wire_limit FROM budget_days WHERE day_utc = $1::date FOR UPDATE`,
    [budgetDay],
  );
  const row = budget.rows[0];
  if (row === undefined) return { kind: "budget_blocked" };
  if (
    row.reserved + row.consumed + 1 >
    Math.min(row.wire_limit, input.wireLimit)
  )
    return { kind: "budget_blocked" };
  const rateLimit = await reserveJungleScoutRateLimit(client, {
    accountScope: input.accountScope,
    approvedDailyCap: approvedLimit,
    budgetDay,
    testNow: input.testNow,
  });
  if (rateLimit.kind === "deferred") {
    return {
      kind: "deferred",
      reason: "rate_limit",
      retryAt: rateLimit.retryAt,
    };
  }

  try {
    const attempt = await client.query<{ id: string }>(
      `WITH credential AS (UPDATE api_operations SET credential_revision=$3 WHERE id=$1 RETURNING id)
       INSERT INTO api_attempts (operation_id, budget_day, status)
       SELECT id, $2::date, 'authorized' FROM credential RETURNING id`,
      [operationId, budgetDay, input.credentialRevision ?? null],
    );
    const attemptId = attempt.rows[0]?.id;
    if (attemptId === undefined) throw new Error("attempt insert failed");
    await client.query(
      "UPDATE budget_days SET reserved = reserved + 1 WHERE day_utc = $1::date",
      [budgetDay],
    );
    return {
      kind: "authorized",
      attemptId,
      operationId,
      budgetDay,
      attemptNumber: (pendingRetry?.retryCount ?? 0) + 1,
    };
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505")
      return { kind: "already_handled", reason: "in_flight" };
    throw error;
  }
}

export async function markDispatching(
  client: PoolClient,
  attemptId: string,
): Promise<void> {
  await client.query(
    `UPDATE api_attempts SET status = 'dispatching' WHERE id = $1 AND status = 'authorized'`,
    [attemptId],
  );
}

export async function finalizeAttempt(
  client: PoolClient,
  input: {
    readonly attemptId: string;
    readonly budgetDay: string;
    readonly fingerprint: string;
    readonly status: "succeeded" | "http_failed" | "outcome_unknown";
    readonly httpStatus: number | null;
    readonly cacheBody?: unknown;
    readonly retryAt?: Date;
  },
): Promise<FinalizeDecision> {
  await client.query(
    "SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)",
    [input.fingerprint],
  );
  const finalized = await client.query<{
    operation_id: string;
    generation: number;
  }>(
    `UPDATE api_attempts a SET status=$2,http_status=$3,finished_at=now()
     FROM api_operations o
     WHERE a.id=$1 AND a.operation_id=o.id AND o.fingerprint=$4
       AND a.budget_day=$5::date AND a.status='dispatching'
     RETURNING a.operation_id,o.generation`,
    [
      input.attemptId,
      input.status,
      input.httpStatus,
      input.fingerprint,
      input.budgetDay,
    ],
  );
  const finalizedRow = finalized.rows[0];
  if (finalizedRow === undefined) return { kind: "unchanged" };
  if (input.status === "outcome_unknown") return { kind: "finalized" };
  const budget = await client.query(
    `UPDATE budget_days SET reserved=reserved-1,consumed=consumed+1
     WHERE day_utc=$1::date AND reserved>=1 RETURNING day_utc`,
    [input.budgetDay],
  );
  if (budget.rowCount !== 1)
    throw new Error("Attempt budget reservation missing");
  if (input.status === "http_failed" && input.retryAt !== undefined) {
    const retry = await scheduleRetry(client, {
      operationId: finalizedRow.operation_id,
      retryAt: input.retryAt,
    });
    if (retry !== null)
      return { kind: "retry_scheduled", retryAt: retry.retryAt };
    await clearRetry(client, finalizedRow.operation_id);
  } else {
    await clearRetry(client, finalizedRow.operation_id);
  }
  if (input.status === "succeeded" && input.cacheBody !== undefined) {
    await client.query(
      `INSERT INTO api_cache (fingerprint, generation, body, ttl_hours)
       VALUES ($1, $2, $3::jsonb, 24)
       ON CONFLICT (fingerprint) DO UPDATE SET body = EXCLUDED.body, stored_at = now(), generation = EXCLUDED.generation`,
      [
        input.fingerprint,
        finalizedRow.generation,
        JSON.stringify(input.cacheBody),
      ],
    );
  }
  return { kind: "finalized" };
}
