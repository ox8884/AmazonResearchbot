import { maximumAiRequestCostUsd } from "@forge-ops/domain";
import type { PoolClient } from "pg";
import { loadAiTestGrantCandidate, selectApprovedAiProfile } from "./ai-profile-selection.ts";
import type {
  AiTestGrantCandidate,
  AiAttemptFinalState,
  AiExecutionMode,
  AiExecutionPreparation,
  AiExecutionRole,
  AiReportedUsage,
} from "./ai-execution-types.ts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function dayFor(now: Date): string | null {
  return Number.isFinite(now.getTime()) ? now.toISOString().slice(0, 10) : null;
}

async function lockOperation(client: PoolClient, operationId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `ai_execution:${operationId}`,
  ]);
}

export async function prepareAiExecution(
  client: PoolClient,
  input: {
    readonly operationId: string;
    readonly role: AiExecutionRole;
    readonly mode: AiExecutionMode;
    readonly now: Date;
    readonly grantApprovalId?: string;
    readonly verifyApproval: (candidate: AiTestGrantCandidate) => boolean;
  },
): Promise<AiExecutionPreparation> {
  if ((input.mode === "test" && (!input.grantApprovalId || !isUuid(input.grantApprovalId))) || (input.mode !== "test" && input.grantApprovalId)) return {kind:"no_provider",operationId:input.operationId};
  if (!isUuid(input.operationId)) return { kind: "already_handled", operationId: input.operationId };
  const budgetDay = dayFor(input.now);
  if (!budgetDay) return { kind: "budget_blocked", operationId: input.operationId };
  await lockOperation(client, input.operationId);
  const operation = await client.query<{ readonly state: string; readonly role: string; readonly mode: string;readonly grant_approval_id:string|null }>(
    "SELECT state,role,mode,grant_approval_id FROM ai_execution_operations WHERE id=$1::uuid FOR UPDATE",
    [input.operationId],
  );
  const existing = operation.rows[0];
  if (existing && (existing.role !== input.role || existing.mode !== input.mode || existing.grant_approval_id !== (input.grantApprovalId ?? null) || !["pending","budget_blocked","no_provider","price_unknown"].includes(existing.state)))
    return { kind: "already_handled", operationId: input.operationId };
  if (!existing) {
    await client.query(
      "INSERT INTO ai_execution_operations(id,role,mode,grant_approval_id,state) VALUES($1::uuid,$2,$3,$4,'pending')",
      [input.operationId, input.role, input.mode, input.grantApprovalId ?? null],
    );
  }
  const inflight=await client.query("SELECT id FROM ai_execution_attempts WHERE operation_id=$1 AND state IN ('authorized','dispatching','outcome_unknown','succeeded') LIMIT 1",[input.operationId]);
  if(inflight.rowCount)return {kind:"already_handled",operationId:input.operationId};
  await client.query("UPDATE ai_execution_operations SET state='pending',updated_at=now() WHERE id=$1",[input.operationId]);
  const testGrant=input.mode==='test'&&input.grantApprovalId?await loadAiTestGrantCandidate(client,input.grantApprovalId):null;
  const profile=input.mode==='test'?(testGrant&&input.verifyApproval(testGrant)?testGrant.profile:null):await selectApprovedAiProfile(client,input,input.verifyApproval);
  if (!profile) {
    const attempts = await client.query<{ readonly exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM ai_execution_attempts WHERE operation_id=$1::uuid) AS exists",
      [input.operationId],
    );
    await client.query(
      "UPDATE ai_execution_operations SET state=$2,updated_at=now() WHERE id=$1::uuid",
      [input.operationId, attempts.rows[0]?.exists ? "failed_non_dispatch" : "no_provider"],
    );
    return { kind: "no_provider", operationId: input.operationId };
  }
  const maximumCostUsd = maximumAiRequestCostUsd(profile.config);
  if (maximumCostUsd === null || !/[1-9]/.test(maximumCostUsd)) {
    await client.query(
      "UPDATE ai_execution_operations SET state='price_unknown',updated_at=now() WHERE id=$1::uuid",
      [input.operationId],
    );
    return { kind: "price_unknown", operationId: input.operationId };
  }
  await client.query(
    `INSERT INTO ai_provider_day_costs(profile_id,day_utc,reserved_usd,consumed_usd)
     VALUES($1,$2::date,0,0) ON CONFLICT(profile_id,day_utc) DO NOTHING`,
    [profile.id, budgetDay],
  );
  const reserved = await client.query(
    `UPDATE ai_provider_day_costs SET reserved_usd=reserved_usd+$3::numeric
     WHERE profile_id=$1 AND day_utc=$2::date
       AND reserved_usd+consumed_usd+$3::numeric <= $4::numeric
     RETURNING profile_id`,
    [profile.id, budgetDay, maximumCostUsd, profile.config.dailyBudgetUsd],
  );
  if (reserved.rowCount !== 1) {
    await client.query(
      "UPDATE ai_execution_operations SET state='budget_blocked',updated_at=now() WHERE id=$1::uuid",
      [input.operationId],
    );
    return { kind: "budget_blocked", operationId: input.operationId };
  }
  const attempt = await client.query<{ readonly id: string }>(
    `INSERT INTO ai_execution_attempts(operation_id,profile_id,role,profile_version,key_revision,config_fingerprint,budget_day,reserved_usd,state)
     VALUES($1::uuid,$2,$3,$4,$5,$6,$7::date,$8::numeric,'authorized')
     ON CONFLICT(operation_id,profile_id) DO NOTHING RETURNING id`,
    [input.operationId, profile.id, input.role, profile.version, profile.keyRevision, profile.configFingerprint, budgetDay, maximumCostUsd],
  );
  const attemptId = attempt.rows[0]?.id;
  if (!attemptId) {
    await client.query(
      "UPDATE ai_provider_day_costs SET reserved_usd=reserved_usd-$3::numeric WHERE profile_id=$1 AND day_utc=$2::date AND reserved_usd >= $3::numeric",
      [profile.id, budgetDay, maximumCostUsd],
    );
    return { kind: "already_handled", operationId: input.operationId };
  }
  return { kind: "dispatch_ready", attemptId, operationId: input.operationId, profile, reservedUsd: maximumCostUsd, budgetDay };
}

export async function markAiAttemptDispatching(client: PoolClient, attemptId: string): Promise<boolean> {
  const attempt = await client.query<{ readonly operation_id: string }>(
    "UPDATE ai_execution_attempts SET state='dispatching' WHERE id=$1 AND state='authorized' RETURNING operation_id",
    [attemptId],
  );
  const operationId = attempt.rows[0]?.operation_id;
  if (!operationId) return false;
  await client.query(
    "UPDATE ai_execution_operations SET state='dispatching',updated_at=now() WHERE id=$1::uuid AND state='pending'",
    [operationId],
  );
  return true;
}

export async function finalizeAiExecution(
  client: PoolClient,
  input: {
    readonly attemptId: string;
    readonly state: AiAttemptFinalState;
    readonly providerStatus: number | null;
    readonly usage: AiReportedUsage;
    readonly resultPayload?: unknown;
  },
): Promise<boolean> {
  const initial = await client.query<{ readonly operation_id: string; readonly profile_id: string }>(
    "SELECT operation_id,profile_id FROM ai_execution_attempts WHERE id=$1",
    [input.attemptId],
  );
  const reference = initial.rows[0];
  if (!reference) return false;
  await lockOperation(client, reference.operation_id);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `custom_ai_profile:${reference.profile_id}`,
  ]);
  const attempt = await client.query<{
    readonly operation_id: string;
    readonly profile_id: string;
    readonly budget_day: string;
    readonly reserved_usd: string;
  }>(
    "SELECT operation_id,profile_id,budget_day::text,reserved_usd::text FROM ai_execution_attempts WHERE id=$1 AND state='dispatching' FOR UPDATE",
    [input.attemptId],
  );
  const current = attempt.rows[0];
  if (!current) return false;
  await client.query(
    `UPDATE ai_execution_attempts SET state=$2,provider_status=$3,usage_known=$4,reported_input_tokens=$5,reported_output_tokens=$6,finished_at=now()
     WHERE id=$1`,
    [input.attemptId, input.state, input.providerStatus, input.usage.known, input.usage.known ? input.usage.inputTokens : null, input.usage.known ? input.usage.outputTokens : null],
  );
  if (input.state !== "outcome_unknown") {
    const budget = input.state === "failed_non_dispatch"
      ? await client.query(
        "UPDATE ai_provider_day_costs SET reserved_usd=reserved_usd-$3::numeric WHERE profile_id=$1 AND day_utc=$2::date AND reserved_usd >= $3::numeric RETURNING profile_id",
        [current.profile_id, current.budget_day, current.reserved_usd],
      )
      : await client.query(
        "UPDATE ai_provider_day_costs SET reserved_usd=reserved_usd-$3::numeric,consumed_usd=consumed_usd+$3::numeric WHERE profile_id=$1 AND day_utc=$2::date AND reserved_usd >= $3::numeric RETURNING profile_id",
        [current.profile_id, current.budget_day, current.reserved_usd],
      );
    if (budget.rowCount !== 1) throw new Error("AI execution reservation missing");
  }
  const operationState = input.state === "failed_non_dispatch" ? "pending" : input.state;
  await client.query(
    "UPDATE ai_execution_operations SET state=CASE WHEN mode='test' AND $2='pending' THEN 'failed_non_dispatch' ELSE $2 END,result_payload=$3::jsonb,updated_at=now() WHERE id=$1::uuid",
    [current.operation_id, operationState, JSON.stringify(input.resultPayload ?? null)],
  );
  return true;
}
