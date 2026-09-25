import { z } from "zod";

export const CUSTOM_AI_PROTOCOL = "openai_chat_completions" as const;
/** codex_cli runs the server's `codex exec` signed in with a ChatGPT plan; baseUrl and the key are unused. */
export const CUSTOM_AI_PROTOCOLS = [CUSTOM_AI_PROTOCOL, "codex_cli"] as const;
export type CustomAiProtocol = (typeof CUSTOM_AI_PROTOCOLS)[number];

export const CUSTOM_AI_ROLES = [
  "normalize",
  "niche_analysis",
  "sourcing_analysis",
  "rfq_draft",
] as const;

export const customAiProfileStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "active",
  "disabled",
]);

const dailyBudgetUsdSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/);

const perMillionUsdSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/);

const retentionPolicyUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => value.startsWith("https://"))
  .refine((value) => !/https:\/\/[^/?#]*@/.test(value))
  .refine((value) => !/[?#]/.test(value));

export const customAiProviderConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(200),
    baseUrl: z.string().trim().url().max(2000),
    protocol: z.enum(CUSTOM_AI_PROTOCOLS).default(CUSTOM_AI_PROTOCOL),
    dailyBudgetUsd: dailyBudgetUsdSchema,
    roles: z
      .array(z.enum(CUSTOM_AI_ROLES))
      .max(CUSTOM_AI_ROLES.length)
      .refine((roles) => new Set(roles).size === roles.length)
      .default([]),
    priority: z.number().int().min(0).max(100).default(0),
    inputUsdPerMillion: perMillionUsdSchema.nullable().default(null),
    outputUsdPerMillion: perMillionUsdSchema.nullable().default(null),
    maxInputTokens: z.number().int().min(1).max(131072).default(1024),
    maxOutputTokens: z.number().int().min(1).max(16384).default(256),
    retentionPolicyUrl: retentionPolicyUrlSchema.nullable().default(null),
  })
  .strict();

export const customAiProfileWriteSchema = customAiProviderConfigSchema
  .extend({
    id: z.uuid().optional(),
    version: z.number().int().nonnegative(),
    apiKey: z.string().trim().max(8000).default(""),
  })
  .strict();

export const customAiActivationRequestSchema = z
  .object({
    version: z.number().int().positive(),
    productEvidenceScope: z.literal('short-excerpts-v1').optional(),
  })
  .strict();

export const customAiProviderActivationSchema = z
  .object({
    payloadVersion: z.literal(1),
    providerType: z.literal("custom_ai"),
    purpose: z.literal("activation"),
    productEvidenceScope: z.literal('short-excerpts-v1').optional(),
    profileId: z.uuid(),
    version: z.number().int().positive(),
    keyRevision: z.number().int().positive(),
    configFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    displayedConfig: customAiProviderConfigSchema,
  })
  .strict();

export type CustomAiProviderConfig = z.infer<typeof customAiProviderConfigSchema>;
export type CustomAiProfileWrite = z.infer<typeof customAiProfileWriteSchema>;
export type CustomAiProviderActivation = z.infer<typeof customAiProviderActivationSchema>;
export type CustomAiProfileStatus = z.infer<typeof customAiProfileStatusSchema>;
