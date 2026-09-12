import {
  aiTestApprovalSchema,
  customAiProviderActivationSchema,
  customAiProviderConfigSchema,
} from "@forge-ops/domain";
import type { PoolClient } from "pg";
import type {
  AiApprovedProfile,
  AiExecutionRole,
  AiTestGrantCandidate,
} from "./ai-execution-types.ts";

type CandidateRow = {
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
  readonly key_revision: number;
  readonly version: number;
  readonly approval_payload: unknown;
  readonly approval_hash?: string;
  readonly approval_id?: string;
};

function configMatches(
  left: ReturnType<typeof customAiProviderConfigSchema.parse>,
  right: ReturnType<typeof customAiProviderConfigSchema.parse>,
): boolean {
  return (
    left.name === right.name &&
    left.model === right.model &&
    left.baseUrl === right.baseUrl &&
    left.protocol === right.protocol &&
    left.dailyBudgetUsd === right.dailyBudgetUsd &&
    left.priority === right.priority &&
    left.inputUsdPerMillion === right.inputUsdPerMillion &&
    left.outputUsdPerMillion === right.outputUsdPerMillion &&
    left.maxInputTokens === right.maxInputTokens &&
    left.maxOutputTokens === right.maxOutputTokens &&
    left.retentionPolicyUrl === right.retentionPolicyUrl &&
    left.roles.length === right.roles.length &&
    left.roles.every((role, index) => role === right.roles[index])
  );
}

function configFromRow(row: CandidateRow) {
  return customAiProviderConfigSchema.safeParse({
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

function profileFromRow(row: CandidateRow): AiApprovedProfile | null {
  if (row.api_key_ciphertext === null) return null;
  const config = configFromRow(row);
  const approval = customAiProviderActivationSchema.safeParse(row.approval_payload);
  if (!config.success || !approval.success) return null;
  const activation = approval.data;
  if (
    activation.profileId !== row.id ||
    activation.version !== row.version ||
    activation.keyRevision !== row.key_revision ||
    !configMatches(config.data, activation.displayedConfig)
  ) return null;
  return {
    id: row.id,
    version: row.version,
    keyRevision: row.key_revision,
    configFingerprint: activation.configFingerprint,
    apiKeyCiphertext: row.api_key_ciphertext,
    config: config.data,
  };
}

export async function selectApprovedAiProfile(
  client: PoolClient,
  input: { readonly operationId: string; readonly role: AiExecutionRole },
  verify: (candidate: AiTestGrantCandidate) => boolean,
): Promise<AiApprovedProfile | null> {
  const ids = await client.query<{ readonly id: string }>(
    `SELECT p.id
     FROM custom_ai_profiles p
     WHERE p.status='active' AND p.roles @> ARRAY[$1]::text[]
       AND NOT EXISTS (
         SELECT 1 FROM ai_execution_attempts a
         WHERE a.operation_id=$2::uuid AND a.profile_id=p.id
       )
     ORDER BY p.priority ASC,p.id ASC`,
    [input.role, input.operationId],
  );
  for (const candidate of ids.rows) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `custom_ai_profile:${candidate.id}`,
    ]);
    const current = await client.query<CandidateRow>(
      `SELECT p.id,p.name,p.base_url,p.model,p.protocol,p.daily_budget_usd,p.roles,p.priority,p.input_usd_per_million,p.output_usd_per_million,p.max_input_tokens,p.max_output_tokens,p.retention_policy_url,p.api_key_ciphertext,p.key_revision,p.version,a.payload AS approval_payload,a.payload_hash AS approval_hash,a.id AS approval_id
       FROM custom_ai_profiles p
       JOIN LATERAL (
         SELECT id,payload,payload_hash FROM approvals
         WHERE kind='provider_activation' AND status='approved'
           AND payload->>'providerType'='custom_ai'
           AND payload->>'purpose'='activation'
           AND payload->>'profileId'=p.id::text
         ORDER BY created_at DESC,id DESC LIMIT 1
       ) a ON true
       WHERE p.id=$1 AND p.status='active' AND p.roles @> ARRAY[$2]::text[]
       FOR UPDATE OF p`,
      [candidate.id, input.role],
    );
    const row = current.rows[0];
    if (!row) continue;
    const profile = profileFromRow(row);
    if (profile && row.approval_hash && row.approval_id && verify({approvalId:row.approval_id,payload:row.approval_payload,payloadHash:row.approval_hash,profile})) return profile;
  }
  return null;
}

export async function loadAiTestGrantCandidate(
  client: PoolClient,
  approvalId: string,
): Promise<AiTestGrantCandidate | null> {
  const hinted = await client.query<{ readonly payload: unknown }>(
    "SELECT id,payload,payload_hash FROM approvals WHERE id=$1 AND kind='provider_activation'",
    [approvalId],
  );
  const hint = hinted.rows[0];
  const parsedHint = hint ? aiTestApprovalSchema.safeParse(hint.payload) : null;
  if (!parsedHint?.success) return null;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `custom_ai_profile:${parsedHint.data.profileId}`,
  ]);
  const loaded = await client.query<CandidateRow>(
    `SELECT p.id,p.name,p.base_url,p.model,p.protocol,p.daily_budget_usd,p.roles,p.priority,p.input_usd_per_million,p.output_usd_per_million,p.max_input_tokens,p.max_output_tokens,p.retention_policy_url,p.api_key_ciphertext,p.key_revision,p.version,a.payload AS approval_payload,a.payload_hash AS approval_hash,a.id AS approval_id
     FROM approvals a JOIN custom_ai_profiles p ON a.payload->>'profileId'=p.id::text
     WHERE a.id=$1 AND a.kind='provider_activation' AND a.status='approved'
       AND a.payload->>'providerType'='custom_ai' AND a.payload->>'purpose'='test'
     FOR UPDATE OF a,p`,
    [approvalId],
  );
  const row = loaded.rows[0];
  if (!row || row.api_key_ciphertext === null || !row.approval_hash || !row.approval_id) return null;
  const config = configFromRow(row);
  const grant = aiTestApprovalSchema.safeParse(row.approval_payload);
  if (!config.success || !grant.success) return null;
  return {
    approvalId: row.approval_id,
    payload: row.approval_payload,
    payloadHash: row.approval_hash,
    profile: {
      id: row.id,
      version: row.version,
      keyRevision: row.key_revision,
      configFingerprint: grant.data.configFingerprint,
      apiKeyCiphertext: row.api_key_ciphertext,
      config: config.data,
    },
  };
}
