import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "@forge-ops/db";
import { z } from "zod";

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES = 5;
const PASSWORD_PATH = "/api/auth/sign-in/email";
const TWO_FACTOR_PATHS = ["/api/auth/two-factor/verify-totp", "/api/auth/two-factor/verify-backup-code", "/api/auth/two-factor/verify-otp"] as const;
const TWO_FACTOR_COOKIE_NAMES = [
  "__Secure-better-auth.two_factor",
  "better-auth.two_factor",
] as const;
const SENSITIVE_PASSWORD_PATHS = ["/api/auth/change-password", "/api/auth/two-factor/enable", "/api/auth/two-factor/disable", "/api/auth/two-factor/generate-backup-codes"] as const;
const passwordBodySchema = z.object({ email: z.string().optional() }).passthrough();

type AuthThrottleKind = "password" | "totp" | "sensitive";

type AuthThrottleReservation = {
  readonly kind: "reserved";
  readonly attemptId: string;
};

type AuthThrottleBypass = {
  readonly kind: "bypass";
};

export type AuthThrottleBlocked = {
  readonly kind: "blocked";
  readonly status: 423;
  readonly body: {
    readonly code: "LOCKED";
    readonly message: "Too many failed sign-ins. Try again in 15 minutes.";
  };
};

export type AuthThrottleRejected = {
  readonly kind: "rejected";
  readonly status: 401;
  readonly body: {
    readonly code: "UNAUTHORIZED";
    readonly message: "Sign-in unavailable.";
  };
};

export type AuthThrottleAdmission =
  | AuthThrottleBypass
  | AuthThrottleReservation
  | AuthThrottleBlocked
  | AuthThrottleRejected;

export type AuthThrottleInput = {
  readonly method: string;
  readonly pathname: string;
  readonly ip: string;
  readonly cookieHeader?: string;
  readonly sessionHeaders?: Headers;
  readonly body: unknown;
};

type StatusResponse = {
  readonly status: number;
};

type AuthThrottleHandled<Response extends StatusResponse> = {
  readonly kind: "handled";
  readonly response: Response;
};

export type AuthThrottleRunResult<Response extends StatusResponse> =
  | AuthThrottleHandled<Response>
  | AuthThrottleBlocked
  | AuthThrottleRejected;

type AuthThrottleOptions = {
  readonly pool: Pool;
  readonly authSecret: string;
  readonly resolveTrustedSessionAccount: (input: AuthThrottleInput) => Promise<string | null>;
};

function endpointKind(input: AuthThrottleInput): AuthThrottleKind | null {
  if (input.method !== "POST") return null;
  if (input.pathname === PASSWORD_PATH) return "password";
  if (SENSITIVE_PASSWORD_PATHS.some(path => path === input.pathname)) return "sensitive";
  if (TWO_FACTOR_PATHS.some(path => path === input.pathname)) return "totp";
  return null;
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function passwordAccount(body: unknown): string {
  const parsed = passwordBodySchema.safeParse(body);
  return parsed.success && parsed.data.email ? normalizedEmail(parsed.data.email) : "";
}

function cookieValue(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  let selected: string | null = null;
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    const name = entry.slice(0, separator).trim();
    if (!TWO_FACTOR_COOKIE_NAMES.some((cookieName) => cookieName === name)) continue;
    if (selected !== null) return null;
    try {
      selected = decodeURIComponent(entry.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return selected;
}

function signedChallengeId(cookie: string | null, authSecret: string): string | null {
  if (!cookie) return null;
  const separator = cookie.lastIndexOf(".");
  if (separator < 1 || separator === cookie.length - 1) return null;
  const identifier = cookie.slice(0, separator);
  const suppliedSignature = Buffer.from(cookie.slice(separator + 1), "base64");
  const expectedSignature = createHmac("sha256", authSecret).update(identifier).digest();
  if (suppliedSignature.length !== expectedSignature.length) return null;
  return timingSafeEqual(suppliedSignature, expectedSignature) ? identifier : null;
}

async function totpAccount(
  options: AuthThrottleOptions,
  input: AuthThrottleInput,
): Promise<string | null> {
  const sessionAccount = await options.resolveTrustedSessionAccount(input);
  if (sessionAccount) return normalizedEmail(sessionAccount);
  const identifier = signedChallengeId(cookieValue(input.cookieHeader), options.authSecret);
  if (!identifier) return null;
  const result = await options.pool.query<{ email: string }>(
    `SELECT u.email
     FROM verification AS v
     INNER JOIN "user" AS u ON u.id = v.value
     WHERE v.identifier = $1 AND v.expires_at > now()
     LIMIT 1`,
    [identifier],
  );
  const email = result.rows[0]?.email;
  return email ? normalizedEmail(email) : null;
}

async function reserveFailure(pool: Pool, email: string, ip: string): Promise<AuthThrottleReservation | AuthThrottleBlocked> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([email, ip])]);
    const failures = await client.query<{ locked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM login_attempts cutoff
         WHERE cutoff.email_normalized=$1 AND cutoff.ip=$2 AND cutoff.success=false
           AND cutoff.created_at > now()-($3 * interval '1 second')
           AND (SELECT count(*) FROM login_attempts prior
                WHERE prior.email_normalized=$1 AND prior.ip=$2 AND prior.success=false
                  AND prior.created_at > cutoff.created_at-($3 * interval '1 second')
                  AND prior.created_at <= cutoff.created_at) >= $4
       ) AS locked`,
      [email, ip, WINDOW_SECONDS, MAX_FAILURES],
    );
    if (failures.rows[0]?.locked === true) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return {
        kind: "blocked",
        status: 423,
        body: {
          code: "LOCKED",
          message: "Too many failed sign-ins. Try again in 15 minutes.",
        },
      };
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO login_attempts(email_normalized, ip, success)
       VALUES($1, $2, false)
       RETURNING id`,
      [email, ip],
    );
    const attemptId = inserted.rows[0]?.id;
    if (!attemptId) throw new Error("login attempt reservation missing id");
    await client.query("COMMIT");
    transactionOpen = false;
    return { kind: "reserved", attemptId };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordOutcome(pool: Pool, reservation: AuthThrottleReservation, succeeded: boolean): Promise<void> {
  await pool.query(
    `UPDATE login_attempts
     SET success = success OR $2
     WHERE id = $1`,
    [reservation.attemptId, succeeded],
  );
}

export function createAuthThrottle(options: AuthThrottleOptions) {
  const beforeHandler = async (input: AuthThrottleInput): Promise<AuthThrottleAdmission> => {
    const kind = endpointKind(input);
    if (!kind) return { kind: "bypass" };
    const ip = input.ip.trim();
    if (!ip) {
      return {
        kind: "rejected",
        status: 401,
        body: { code: "UNAUTHORIZED", message: "Sign-in unavailable." },
      };
    }
    const sessionAccount = kind === "sensitive" ? await options.resolveTrustedSessionAccount(input) : null;
    const email = kind === "password" ? passwordAccount(input.body) : kind === "sensitive" ? (sessionAccount ? normalizedEmail(sessionAccount) : null) : await totpAccount(options, input);
    if (email === null) {
      return {
        kind: "rejected",
        status: 401,
        body: { code: "UNAUTHORIZED", message: "Sign-in unavailable." },
      };
    }
    return reserveFailure(options.pool, email, ip);
  };

  const afterHandler = async <Response extends StatusResponse>(
    reservation: AuthThrottleReservation,
    response: Response,
  ): Promise<void> => recordOutcome(options.pool, reservation, response.status < 400);

  const afterThrownHandler = async (reservation: AuthThrottleReservation): Promise<void> =>
    recordOutcome(options.pool, reservation, false);

  const run = async <Response extends StatusResponse>(
    input: AuthThrottleInput,
    handler: () => Promise<Response>,
  ): Promise<AuthThrottleRunResult<Response>> => {
    const admission = await beforeHandler(input);
    if (admission.kind === "blocked" || admission.kind === "rejected") return admission;
    try {
      const response = await handler();
      if (admission.kind === "reserved") await afterHandler(admission, response);
      return { kind: "handled", response };
    } catch (error) {
      if (admission.kind === "reserved") await afterThrownHandler(admission);
      throw error;
    }
  };

  return { beforeHandler, afterHandler, afterThrownHandler, run };
}
