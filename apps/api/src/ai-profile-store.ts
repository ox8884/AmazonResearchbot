import { randomUUID } from "node:crypto";
import type { CustomAiProfileWrite } from "@forge-ops/domain";
import type { QueryConnection } from "@forge-ops/db";
import { encryptSecret, exactPayloadHash, last4 } from "@forge-ops/security";
import {
  customAiActivationPayload,
  customAiProfileColumns,
  customAiProfileIsEligible,
  customAiProfileView,
  lockCustomAiProfile,
  type CustomAiProfileRow,
  type CustomAiProfileView,
} from "./ai-profile-core.ts";

export type SaveCustomAiProfileResult =
  | { readonly kind: "saved"; readonly created: boolean; readonly profile: CustomAiProfileView }
  | { readonly kind: "not_found" }
  | { readonly kind: "stale" };

export async function saveCustomAiProfile(
  db: QueryConnection,
  input: CustomAiProfileWrite,
  key: Buffer,
  actor: string,
): Promise<SaveCustomAiProfileResult> {
  const id = input.id ?? randomUUID();
  const current = await lockCustomAiProfile(db, id);
  if (input.id && !current) return { kind: "not_found" };
  if (input.version !== (current?.version ?? 0)) return { kind: "stale" };

  const secretUpdated = input.apiKey.length > 0;
  const keyRevision = (current?.key_revision ?? 0) + (secretUpdated ? 1 : 0);
  const cipher = secretUpdated
    ? encryptSecret(Buffer.from(input.apiKey), key, `custom-ai:${id}:key`)
    : (current?.api_key_ciphertext ?? null);
  const keyLast4 = secretUpdated
    ? last4(input.apiKey)
    : (current?.api_key_last4 ?? null);
  const values = [
    id,
    input.name,
    input.baseUrl,
    input.model,
    input.protocol,
    input.dailyBudgetUsd,
    input.roles,
    input.priority,
    input.inputUsdPerMillion,
    input.outputUsdPerMillion,
    input.maxInputTokens,
    input.maxOutputTokens,
    input.retentionPolicyUrl,
    cipher,
    keyLast4,
    keyRevision,
  ];
  const result = await db.query<CustomAiProfileRow>(
    current
      ? `UPDATE custom_ai_profiles
         SET name=$2,base_url=$3,model=$4,protocol=$5,daily_budget_usd=$6,roles=$7::text[],priority=$8,input_usd_per_million=$9,output_usd_per_million=$10,max_input_tokens=$11,max_output_tokens=$12,retention_policy_url=$13,api_key_ciphertext=$14,api_key_last4=$15,key_revision=$16,status='draft',version=version+1,updated_at=now()
         WHERE id=$1 RETURNING ${customAiProfileColumns}`
      : `INSERT INTO custom_ai_profiles(id,name,base_url,model,protocol,daily_budget_usd,roles,priority,input_usd_per_million,output_usd_per_million,max_input_tokens,max_output_tokens,retention_policy_url,api_key_ciphertext,api_key_last4,key_revision,status,version)
         VALUES($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',1)
         RETURNING ${customAiProfileColumns}`,
    values,
  );
  const saved = result.rows[0];
  if (!saved) throw new Error("Custom AI profile was not saved");
  if (current) {
    await db.query(
      `UPDATE approvals SET status='stale'
       WHERE kind='provider_activation' AND status='pending'
         AND payload->>'providerType'='custom_ai'
         AND payload->>'purpose'='activation'
         AND payload->>'profileId'=$1`,
      [saved.id],
    );
  }
  await db.query(
    "INSERT INTO audit_events(actor,action,target,meta) VALUES($1,'custom_ai_draft_saved',$2,$3::jsonb)",
    [actor, saved.id, JSON.stringify({ version: saved.version, status: saved.status, secretUpdated })],
  );
  return { kind: "saved", created: !current, profile: customAiProfileView(saved) };
}

export type CustomAiActivationResult =
  | { readonly kind: "created" | "reused"; readonly approvalId: string; readonly profile: CustomAiProfileView }
  | { readonly kind: "not_found" | "stale" | "config_required" };

export async function createCustomAiActivationProposal(
  db: QueryConnection,
  actor: string,
  id: string,
  expectedVersion: number,
  productEvidenceScope?: 'short-excerpts-v1',
): Promise<CustomAiActivationResult> {
  const profile = await lockCustomAiProfile(db, id);
  if (!profile) return { kind: "not_found" };
  if (profile.version !== expectedVersion) return { kind: "stale" };
  if (!customAiProfileIsEligible(profile)) return { kind: "config_required" };
  const payload = {...customAiActivationPayload(profile),...(productEvidenceScope?{productEvidenceScope}:{})};
  const existing = await db.query<{ readonly id: string; readonly status: "pending" | "approved" }>(
    `SELECT id,status FROM approvals
     WHERE kind='provider_activation'
       AND status IN ('pending','approved')
       AND payload->>'providerType'='custom_ai'
       AND payload->>'purpose'='activation'
       AND payload->>'profileId'=$1
       AND (payload->>'version')::integer=$2
       AND payload->>'configFingerprint'=$3
       AND (payload->>'productEvidenceScope') IS NOT DISTINCT FROM $4::text
       AND ((status='pending' AND $5='pending_approval') OR (status='approved' AND $5='active'))
     ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
    [profile.id, profile.version, payload.configFingerprint,productEvidenceScope??null,profile.status],
  );
  const existingApproval = existing.rows[0];
  if (existingApproval) {
    return {
      kind: "reused",
      approvalId: existingApproval.id,
      profile: customAiProfileView({ ...profile, approval_payload:payload,approval_id: existingApproval.status === "pending" ? existingApproval.id : null }),
    };
  }
  await db.query("UPDATE approvals SET status='stale' WHERE kind='provider_activation' AND status='pending' AND payload->>'providerType'='custom_ai' AND payload->>'purpose'='activation' AND payload->>'profileId'=$1",[profile.id]);
  const inserted = await db.query<{ readonly id: string }>(
    "INSERT INTO approvals(kind,payload_hash,payload,status) VALUES('provider_activation',$1,$2::jsonb,'pending') RETURNING id",
    [exactPayloadHash(payload), JSON.stringify(payload)],
  );
  const approvalId = inserted.rows[0]?.id;
  if (!approvalId) throw new Error("Custom AI activation proposal was not saved");
  const pending = await db.query<CustomAiProfileRow>(
    `UPDATE custom_ai_profiles SET status='pending_approval',updated_at=now()
     WHERE id=$1 RETURNING ${customAiProfileColumns}`,
    [profile.id],
  );
  const current = pending.rows[0];
  if (!current) throw new Error("Custom AI profile disappeared during activation proposal");
  await db.query(
    "INSERT INTO audit_events(actor,action,target,approval_hash,meta) VALUES($1,'custom_ai_activation_requested',$2,$3,$4::jsonb)",
    [actor, current.id, exactPayloadHash(payload), JSON.stringify({ version: current.version, keyRevision: current.key_revision, protocol: current.protocol })],
  );
  return {
    kind: "created",
    approvalId,
    profile: customAiProfileView({ ...current, approval_payload:payload,approval_id: approvalId }),
  };
}

export type DisableCustomAiProfileResult =
  | { readonly kind: "disabled"; readonly profile: CustomAiProfileView }
  | { readonly kind: "not_found" | "stale" };

export async function disableCustomAiProfile(
  db: QueryConnection,
  actor: string,
  id: string,
  expectedVersion: number,
): Promise<DisableCustomAiProfileResult> {
  const profile = await lockCustomAiProfile(db, id);
  if (!profile) return { kind: "not_found" };
  if (profile.version !== expectedVersion) return { kind: "stale" };
  if (profile.status === "disabled") return { kind: "disabled", profile: customAiProfileView(profile) };
  const result = await db.query<CustomAiProfileRow>(
    `UPDATE custom_ai_profiles SET status='disabled',version=version+1,updated_at=now()
     WHERE id=$1 RETURNING ${customAiProfileColumns}`,
    [profile.id],
  );
  const disabled = result.rows[0];
  if (!disabled) throw new Error("Custom AI profile was not disabled");
  await db.query(
    `UPDATE approvals SET status='stale'
     WHERE kind='provider_activation' AND status='pending'
       AND payload->>'providerType'='custom_ai'
       AND payload->>'purpose'='activation'
       AND payload->>'profileId'=$1`,
    [disabled.id],
  );
  await db.query(
    "INSERT INTO audit_events(actor,action,target,meta) VALUES($1,'custom_ai_disabled',$2,$3::jsonb)",
    [actor, disabled.id, JSON.stringify({ version: disabled.version, status: disabled.status })],
  );
  return { kind: "disabled", profile: customAiProfileView(disabled) };
}
