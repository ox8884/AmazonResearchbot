import type { Pool, PoolClient } from "pg";

export type AttemptDecision =
  | { kind: "authorized"; attemptId: string; operationId: string }
  | { kind: "budget_blocked" }
  | { kind: "already_handled"; reason: "cache" | "unknown" | "in_flight" | "succeeded" };

export type AuthorizeInput = {
  fingerprint: string;
  provider: string;
  endpoint: string;
  budgetDay: string;
  wireLimit: number;
};

export async function recoverDispatchingAttempts(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE api_attempts SET status = 'outcome_unknown', finished_at = now()
     WHERE status = 'dispatching'`,
  );
  return result.rowCount ?? 0;
}

export async function authorizeAttempt(client: PoolClient, input: AuthorizeInput): Promise<AttemptDecision> {
  await client.query(`SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`, [
    input.fingerprint,
  ]);
  const op = await client.query<{ id: string }>(
    `INSERT INTO api_operations (fingerprint, provider, endpoint)
     VALUES ($1, $2, $3)
     ON CONFLICT (fingerprint) DO UPDATE SET provider = api_operations.provider
     RETURNING id`,
    [input.fingerprint, input.provider, input.endpoint],
  );
  const operationId = op.rows[0]?.id;
  if (!operationId) throw new Error("operation insert failed");

  const cache = await client.query<{ stored_at: Date; ttl_hours: number }>(
    `SELECT stored_at, ttl_hours FROM api_cache WHERE fingerprint = $1`,
    [input.fingerprint],
  );
  const cacheRow = cache.rows[0];
  if (cacheRow) {
    const expires = new Date(cacheRow.stored_at.getTime() + cacheRow.ttl_hours * 3600 * 1000);
    if (expires > new Date()) return { kind: "already_handled", reason: "cache" };
  }

  const latest = await client.query<{ status: string }>(
    `SELECT status FROM api_attempts WHERE operation_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [operationId],
  );
  const status = latest.rows[0]?.status;
  if (status === "dispatching") return { kind: "already_handled", reason: "in_flight" };
  if (status === "outcome_unknown") return { kind: "already_handled", reason: "unknown" };
  if (status === "succeeded" && cacheRow) {
    const expires = new Date(cacheRow.stored_at.getTime() + cacheRow.ttl_hours * 3600 * 1000);
    if (expires > new Date()) return { kind: "already_handled", reason: "succeeded" };
  }

  await client.query(
    `INSERT INTO budget_days (day_utc, wire_limit) VALUES ($1::date, $2)
     ON CONFLICT (day_utc) DO NOTHING`,
    [input.budgetDay, input.wireLimit],
  );
  const budget = await client.query<{ reserved: number; consumed: number; wire_limit: number }>(
    `SELECT reserved, consumed, wire_limit FROM budget_days WHERE day_utc = $1::date FOR UPDATE`,
    [input.budgetDay],
  );
  const row = budget.rows[0];
  if (!row) return { kind: "budget_blocked" };
  if (row.reserved + row.consumed + 1 > row.wire_limit) return { kind: "budget_blocked" };

  try {
    const attempt = await client.query<{ id: string }>(
      `INSERT INTO api_attempts (operation_id, budget_day, status) VALUES ($1, $2::date, 'authorized') RETURNING id`,
      [operationId, input.budgetDay],
    );
    const attemptId = attempt.rows[0]?.id;
    if (!attemptId) throw new Error("attempt insert failed");
    await client.query(`UPDATE budget_days SET reserved = reserved + 1 WHERE day_utc = $1::date`, [input.budgetDay]);
    return { kind: "authorized", attemptId, operationId };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "23505") return { kind: "already_handled", reason: "in_flight" };
    throw err;
  }
}

export async function markDispatching(client: PoolClient, attemptId: string): Promise<void> {
  await client.query(`UPDATE api_attempts SET status = 'dispatching' WHERE id = $1 AND status = 'authorized'`, [
    attemptId,
  ]);
}

export async function finalizeAttempt(
  client: PoolClient,
  input: {
    attemptId: string;
    budgetDay: string;
    fingerprint: string;
    status: "succeeded" | "http_failed" | "outcome_unknown";
    httpStatus: number | null;
    cacheBody?: unknown;
  },
): Promise<void> {
  await client.query(
    `UPDATE api_attempts SET status = $2, http_status = $3, finished_at = now() WHERE id = $1`,
    [input.attemptId, input.status, input.httpStatus],
  );
  if (input.status === "outcome_unknown") return;
  await client.query(
    `UPDATE budget_days SET reserved = GREATEST(reserved - 1, 0), consumed = consumed + 1 WHERE day_utc = $1::date`,
    [input.budgetDay],
  );
  if (input.status === "succeeded" && input.cacheBody !== undefined) {
    await client.query(
      `INSERT INTO api_cache (fingerprint, generation, body, ttl_hours)
       VALUES ($1, 1, $2::jsonb, 24)
       ON CONFLICT (fingerprint) DO UPDATE SET body = EXCLUDED.body, stored_at = now(), generation = api_cache.generation`,
      [input.fingerprint, JSON.stringify(input.cacheBody)],
    );
  }
}

export async function utcBudgetDay(at = new Date()): Promise<string> {
  return at.toISOString().slice(0, 10);
}
