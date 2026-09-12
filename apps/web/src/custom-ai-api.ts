export const aiRoles = [
  "normalize",
  "niche_analysis",
  "sourcing_analysis",
  "rfq_draft",
] as const;
export type AiRole = (typeof aiRoles)[number];
export type AiRouting = {
  roles: readonly AiRole[];
  priority: number;
  inputUsdPerMillion: string | null;
  outputUsdPerMillion: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  retentionPolicyUrl: string | null;
};
export type CustomAiProfile = AiRouting & {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  dailyBudgetUsd: string;
  hasKey: boolean;
  keyLast4: string | null;
  status: "draft" | "pending_approval" | "active" | "disabled";
  approvalId: string | null;
  productEvidenceScope?: 'short-excerpts-v1' | null;
  version: number;
};
export type CustomAiInput = AiRouting & {
  id?: string;
  version: number;
  name: string;
  baseUrl: string;
  model: string;
  dailyBudgetUsd: string;
  apiKey: string;
};
export class CustomAiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function requestCustomAi(
  body?: CustomAiInput | { version?: number; role?: AiRole; productEvidenceScope?: 'short-excerpts-v1' },
  path = "/api/custom-ai",
) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "include",
    signal: AbortSignal.timeout(15000),
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!r.ok) {
    const error: unknown = await r.json();
    throw new CustomAiError(
      typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
        ? error.code
        : "REQUEST_FAILED",
    );
  }
  return r;
}
export async function getCustomAi(): Promise<{ profiles: CustomAiProfile[] }> {
  return (await requestCustomAi()).json();
}
export async function saveCustomAi(
  input: CustomAiInput,
): Promise<{ profile: CustomAiProfile }> {
  return (await requestCustomAi(input)).json();
}

export async function requestAiActivation(
  profile: CustomAiProfile,
  includeProductExcerpts = false,
): Promise<void> {
  await requestCustomAi(
    { version: profile.version,...(includeProductExcerpts?{productEvidenceScope:'short-excerpts-v1' as const}:{}) },
    `/api/custom-ai/${profile.id}/activation-proposals`,
  );
}
export async function disableAi(profile: CustomAiProfile): Promise<void> {
  await requestCustomAi(
    { version: profile.version },
    `/api/custom-ai/${profile.id}/disable`,
  );
}
