import {
  authorizeAttempt,
  finalizeAttempt,
  markDispatching,
  type Pool,
  type AttemptDecision,
  type FinalizeDecision,
} from "@forge-ops/db";
import type { JsEndpointName } from "./endpoints.ts";

export async function authorizeDispatch(
  pool: Pool,
  input: {
    readonly fingerprint: string;
    readonly endpoint: JsEndpointName;
    readonly accountScope: string;
    readonly wireLimit: number;
    readonly testDispatchAt?: Date;
    readonly credentialRevision?: string;
  },
): Promise<AttemptDecision | null> {
  const client = await pool.connect().catch(() => null);
  if (client === null) return null;
  try {
    await client.query("BEGIN");
    const decision = await authorizeAttempt(client, {
      fingerprint: input.fingerprint,
      provider: "junglescout",
      endpoint: input.endpoint,
      accountScope: input.accountScope,
      wireLimit: input.wireLimit,
      testNow: input.testDispatchAt,
      credentialRevision: input.credentialRevision,
    });
    if (decision.kind === "authorized")
      await markDispatching(client, decision.attemptId);
    await client.query("COMMIT");
    return decision;
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return null;
  } finally {
    client.release();
  }
}

export async function finalizeDispatch(
  pool: Pool,
  input: {
    readonly attemptId: string;
    readonly budgetDay: string;
    readonly fingerprint: string;
    readonly status: "succeeded" | "http_failed" | "outcome_unknown";
    readonly httpStatus: number | null;
    readonly cacheBody?: unknown;
    readonly retryAt?: Date;
  },
): Promise<FinalizeDecision | null> {
  const client = await pool.connect().catch(() => null);
  if (client === null) return null;
  try {
    await client.query("BEGIN");
    const finalized = await finalizeAttempt(client, input);
    await client.query("COMMIT");
    return finalized;
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return null;
  } finally {
    client.release();
  }
}
