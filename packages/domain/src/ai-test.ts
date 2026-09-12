import { z } from "zod";
import { CUSTOM_AI_ROLES, customAiProviderConfigSchema } from "./ai-provider.ts";
export const AI_TEST_PROMPT = 'Return only this JSON object: {"forge_test":"ok"}.';
export const aiTestRequestSchema = z.object({version:z.number().int().positive(),role:z.enum(CUSTOM_AI_ROLES)}).strict();
export const aiTestApprovalSchema = z.object({
  payloadVersion:z.literal(1),providerType:z.literal("custom_ai"),purpose:z.literal("test"),
  profileId:z.uuid(),version:z.number().int().positive(),keyRevision:z.number().int().positive(),
  configFingerprint:z.string().regex(/^[a-f0-9]{64}$/),operationId:z.uuid(),role:z.enum(CUSTOM_AI_ROLES),
  displayedConfig:customAiProviderConfigSchema,maxCostUsd:z.string().regex(/^\d{1,6}\.\d{6}$/),prompt:z.literal(AI_TEST_PROMPT),
}).strict();
export type AiTestApproval = z.infer<typeof aiTestApprovalSchema>;
