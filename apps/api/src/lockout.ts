import type { Pool } from "@forge-ops/db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

export async function isLocked(pool: Pool, email: string, ip: string): Promise<boolean> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM login_attempts
     WHERE email_normalized = $1
       AND ip = $2
       AND success = false
       AND created_at > now() - interval '15 minutes'`,
    [email.trim().toLowerCase(), ip],
  );
  return Number(result.rows[0]?.n ?? 0) >= MAX_FAILS;
}

export async function recordAttempt(
  pool: Pool,
  email: string,
  ip: string,
  success: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO login_attempts (email_normalized, ip, success) VALUES ($1, $2, $3)`,
    [email.trim().toLowerCase(), ip, success],
  );
}

export const LOCK_WINDOW_MS = WINDOW_MS;
