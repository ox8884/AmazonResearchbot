import {
  customAiProviderActivationSchema,
  customAiProviderConfigSchema,
  type CustomAiProfileStatus,
} from "@forge-ops/domain";
import type { QueryConnection } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";

export type CustomAiProfileRow = {
  readonly id: string;
  readonly name: string;
  readonly base_url: string;
  readonly model: string;
  readonly protocol: "openai_chat_completions";
  readonly daily_budget_usd: string;
  readonly roles: string[];
  readonly priority: number;
  readonly input_usd_per_million: string | null;
  readonly output_usd_per_million: string | null;
  readonly max_input_tokens: number;
  readonly max_output_tokens: number;
  readonly retention_policy_url: string | null;
  readonly api_key_ciphertext: string | null;
  readonly api_key_last4: string | null;
  readonly key_revision: number;
  readonly status: CustomAiProfileStatus;
  readonly version: number;
  readonly approval_id?: string | null;
  readonly approval_payload?: unknown;
};

export type CustomAiProfileView = {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly protocol: "openai_chat_completions";
  readonly dailyBudgetUsd: string;
  readonly roles: readonly string[];
  readonly priority: number;
  readonly inputUsdPerMillion: string | null;
  readonly outputUsdPerMillion: string | null;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly retentionPolicyUrl: string | null;
  readonly hasKey: boolean;
  readonly keyLast4: string | null;
  readonly keyRevision: number;
  readonly status: CustomAiProfileStatus;
  readonly version: number;
  readonly approvalId: string | null;
  readonly productEvidenceScope: 'short-excerpts-v1' | null;
};

export const customAiProfileColumns = `id,name,base_url,model,protocol,daily_budget_usd,roles,priority,input_usd_per_million,output_usd_per_million,max_input_tokens,max_output_tokens,retention_policy_url,api_key_ciphertext,api_key_last4,key_revision,status,version`;

export function customAiProfileConfigFromRow(row: CustomAiProfileRow) {
  return customAiProviderConfigSchema.parse({
    name: row.name,
    model: row.model,
    baseUrl: row.base_url,
    protocol: row.protocol,
    dailyBudgetUsd: row.daily_budget_usd,
    roles: row.roles,
    priority: row.priority,
    inputUsdPerMillion: row.input_usd_per_million,
    outputUsdPerMillion: row.output_usd_per_million,
    maxInputTokens: row.max_input_tokens,
    maxOutputTokens: row.max_output_tokens,
    retentionPolicyUrl: row.retention_policy_url,
  });
}

export function customAiProfileConfigFingerprint(row: CustomAiProfileRow): string {
  return exactPayloadHash({
    config: customAiProfileConfigFromRow(row),
    keyRevision: row.key_revision,
  });
}

export function customAiProfileIsEligible(row: CustomAiProfileRow): boolean {
  const hasPositiveValue = (value: string | null): boolean =>
    value !== null && /[1-9]/.test(value);
  return (
    row.api_key_ciphertext !== null &&
    row.key_revision > 0 &&
    row.roles.length > 0 &&
    hasPositiveValue(row.daily_budget_usd) &&
    hasPositiveValue(row.input_usd_per_million) &&
    hasPositiveValue(row.output_usd_per_million)
  );
}

export function customAiActivationPayload(row: CustomAiProfileRow) {
  return customAiProviderActivationSchema.parse({
    payloadVersion: 1,
    providerType: "custom_ai",
    purpose: "activation",
    profileId: row.id,
    version: row.version,
    keyRevision: row.key_revision,
    configFingerprint: customAiProfileConfigFingerprint(row),
    displayedConfig: customAiProfileConfigFromRow(row),
  });
}

export function customAiProfileView(row: CustomAiProfileRow): CustomAiProfileView {
  const config = customAiProfileConfigFromRow(row);
  const grant=customAiProviderActivationSchema.safeParse(row.approval_payload);
  const scope=grant.success&&grant.data.profileId===row.id&&grant.data.version===row.version
    &&grant.data.keyRevision===row.key_revision&&grant.data.configFingerprint===customAiProfileConfigFingerprint(row)
    ?grant.data.productEvidenceScope??null:null;
  return {
    id: row.id,
    ...config,
    hasKey: row.api_key_ciphertext !== null,
    keyLast4: row.api_key_last4,
    keyRevision: row.key_revision,
    status: row.status,
    version: row.version,
    approvalId: row.approval_id ?? null,
    productEvidenceScope: scope,
  };
}

export async function readCustomAiProfiles(db: QueryConnection): Promise<readonly CustomAiProfileRow[]> {
  const result = await db.query<CustomAiProfileRow>(
    `SELECT p.${customAiProfileColumns},CASE WHEN p.status='pending_approval' THEN pending.id ELSE NULL END AS approval_id,pending.payload AS approval_payload
     FROM custom_ai_profiles p
     LEFT JOIN LATERAL (
       SELECT id,payload FROM approvals
       WHERE kind='provider_activation' AND ((p.status='pending_approval' AND status='pending') OR (p.status='active' AND status='approved'))
         AND payload->>'providerType'='custom_ai'
         AND payload->>'purpose'='activation'
         AND payload->>'profileId'=p.id::text
         AND payload->>'version'=p.version::text
       ORDER BY created_at DESC,id DESC LIMIT 1
     ) pending ON true
     ORDER BY p.created_at,p.id`,
  );
  return result.rows;
}

export async function lockCustomAiProfile(
  db: QueryConnection,
  id: string,
): Promise<CustomAiProfileRow | null> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `custom_ai_profile:${id}`,
  ]);
  const found = await db.query<CustomAiProfileRow>(
    `SELECT ${customAiProfileColumns} FROM custom_ai_profiles WHERE id=$1 FOR UPDATE`,
    [id],
  );
  return found.rows[0] ?? null;
}
