import type { PoolClient } from "pg";

export const JUNGLE_SCOUT_RATE_LIMITS = {
  perSecond: 15,
  perMinute: 300,
} as const;

export type RateLimitDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "deferred"; readonly retryAt: Date };

export type PendingRetry = {
  readonly retryCount: number;
  readonly retryAt: Date;
};

async function reserveWindow(
  client: PoolClient,
  input: {
    readonly accountScope: string;
    readonly windowKind: "second" | "minute";
    readonly at: Date;
    readonly durationMilliseconds: number;
    readonly limit: number;
  },
): Promise<
  | { readonly kind: "allowed" }
  | { readonly kind: "deferred"; readonly retryAt: Date }
> {
  const current = await client.query<{
    request_count: number;
    oldest_at: Date | null;
  }>(
    `SELECT COALESCE(SUM(request_count),0)::int AS request_count,MIN(window_started_at) AS oldest_at
     FROM api_rate_windows
     WHERE account_scope=$1 AND window_kind=$2
       AND window_started_at > $3::timestamptz - ($4::double precision * interval '1 millisecond')`,
    [
      input.accountScope,
      input.windowKind,
      input.at,
      input.durationMilliseconds,
    ],
  );
  const row = current.rows[0];
  if (row !== undefined && row.request_count >= input.limit) {
    const oldest = row.oldest_at;
    if (oldest === null)
      throw new Error("rate window oldest timestamp missing");
    return {
      kind: "deferred",
      retryAt: new Date(oldest.getTime() + input.durationMilliseconds),
    };
  }
  await client.query(
    `INSERT INTO api_rate_windows(account_scope,window_kind,window_started_at,request_count)
     VALUES($1,$2,$3,1)
     ON CONFLICT(account_scope,window_kind,window_started_at) DO UPDATE
       SET request_count=api_rate_windows.request_count+1`,
    [input.accountScope, input.windowKind, input.at],
  );
  return { kind: "allowed" };
}

export async function reserveJungleScoutRateLimit(
  client: PoolClient,
  input: {
    readonly accountScope: string;
    readonly testNow?: Date;
    readonly budgetDay: string;
    readonly approvedDailyCap: number;
  },
): Promise<RateLimitDecision> {
  const perSecond = Math.min(
    JUNGLE_SCOUT_RATE_LIMITS.perSecond,
    input.approvedDailyCap,
  );
  const perMinute = Math.min(
    JUNGLE_SCOUT_RATE_LIMITS.perMinute,
    input.approvedDailyCap,
  );
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `forge.jungle-scout.rate:${input.accountScope}`,
  ]);
  const rateClock =
    input.testNow === undefined
      ? (
          await client.query<{ rate_at: Date }>(
            "SELECT clock_timestamp() AS rate_at",
          )
        ).rows[0]?.rate_at
      : input.testNow;
  if (!rateClock || !Number.isFinite(rateClock.getTime()))
    throw new Error("Dispatch clock unavailable");
  if (rateClock.toISOString().slice(0, 10) !== input.budgetDay)
    return { kind: "deferred", retryAt: rateClock };
  await client.query("SAVEPOINT jungle_scout_rate_limit");
  const second = await reserveWindow(client, {
    accountScope: input.accountScope,
    windowKind: "second",
    at: rateClock,
    durationMilliseconds: 1_000,
    limit: perSecond,
  });
  if (second.kind === "deferred") {
    await client.query("ROLLBACK TO SAVEPOINT jungle_scout_rate_limit");
    await client.query("RELEASE SAVEPOINT jungle_scout_rate_limit");
    return second;
  }
  const minute = await reserveWindow(client, {
    accountScope: input.accountScope,
    windowKind: "minute",
    at: rateClock,
    durationMilliseconds: 60_000,
    limit: perMinute,
  });
  if (minute.kind === "deferred") {
    await client.query("ROLLBACK TO SAVEPOINT jungle_scout_rate_limit");
    await client.query("RELEASE SAVEPOINT jungle_scout_rate_limit");
    return minute;
  }
  await client.query("RELEASE SAVEPOINT jungle_scout_rate_limit");
  return { kind: "allowed" };
}

export async function loadPendingRetry(
  client: PoolClient,
  operationId: string,
): Promise<PendingRetry | null> {
  const result = await client.query<{
    retry_count: number;
    next_attempt_at: Date;
  }>(
    `SELECT retry_count,next_attempt_at FROM api_retry_schedules
     WHERE operation_id=$1 FOR UPDATE`,
    [operationId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : { retryCount: row.retry_count, retryAt: row.next_attempt_at };
}

export async function scheduleRetry(
  client: PoolClient,
  input: { readonly operationId: string; readonly retryAt: Date },
): Promise<PendingRetry | null> {
  const current = await loadPendingRetry(client, input.operationId);
  const retryCount = (current?.retryCount ?? 0) + 1;
  if (retryCount > 2) return null;
  const result = await client.query<{
    retry_count: number;
    next_attempt_at: Date;
  }>(
    `INSERT INTO api_retry_schedules(operation_id,retry_count,next_attempt_at)
     VALUES($1,$2,$3)
     ON CONFLICT(operation_id) DO UPDATE SET
       retry_count=EXCLUDED.retry_count,
       next_attempt_at=EXCLUDED.next_attempt_at,
       updated_at=now()
     RETURNING retry_count,next_attempt_at`,
    [input.operationId, retryCount, input.retryAt],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("retry schedule persistence failed");
  return { retryCount: row.retry_count, retryAt: row.next_attempt_at };
}

export async function clearRetry(
  client: PoolClient,
  operationId: string,
): Promise<void> {
  await client.query("DELETE FROM api_retry_schedules WHERE operation_id=$1", [
    operationId,
  ]);
}
