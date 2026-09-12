import { randomUUID } from "node:crypto";
import { AI_TEST_PROMPT, aiTestApprovalSchema, type AiTestApproval } from "@forge-ops/domain";
import { maximumAiRequestCostUsd } from "@forge-ops/domain";
import type { QueryConnection } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import { customAiProfileConfigFromRow,customAiProfileConfigFingerprint,customAiProfileIsEligible,lockCustomAiProfile,type CustomAiProfileRow } from "./ai-profile-core.ts";
export async function proposeAiTest(db:QueryConnection,actor:string,profileId:string,version:number,role:AiTestApproval["role"]) {
  const profile=await lockCustomAiProfile(db,profileId);
  if(!profile)return {kind:"blocked",code:"NOT_FOUND"} as const;
  if(profile.version!==version)return {kind:"blocked",code:"PROFILE_CHANGED"} as const;
  const config=customAiProfileConfigFromRow(profile),cost=maximumAiRequestCostUsd(config);
  if(!customAiProfileIsEligible(profile)||!config.roles.includes(role)||cost===null)return {kind:"blocked",code:"PROVIDER_CONFIG_REQUIRED"} as const;
  const existing=await db.query<{id:string;payload:unknown}>("SELECT id,payload FROM approvals WHERE kind='provider_activation' AND status='pending' AND payload->>'purpose'='test' AND payload->>'profileId'=$1 AND payload->>'version'=$2 AND payload->>'role'=$3 ORDER BY created_at DESC LIMIT 1",[profile.id,String(version),role]);
  const previous=existing.rows[0];
  if(previous){const parsed=aiTestApprovalSchema.safeParse(previous.payload);if(parsed.success)return {kind:"reused",approvalId:previous.id,payload:parsed.data} as const;}
  const payload=aiTestApprovalSchema.parse({payloadVersion:1,providerType:"custom_ai",purpose:"test",profileId:profile.id,version:profile.version,keyRevision:profile.key_revision,configFingerprint:customAiProfileConfigFingerprint(profile),operationId:randomUUID(),role,displayedConfig:config,maxCostUsd:cost,prompt:AI_TEST_PROMPT});
  const inserted=await db.query<{id:string}>("INSERT INTO approvals(kind,payload_hash,payload,status) VALUES('provider_activation',$1,$2::jsonb,'pending') RETURNING id",[exactPayloadHash(payload),JSON.stringify(payload)]);
  const approvalId=inserted.rows[0]?.id;if(!approvalId)throw new Error("AI_TEST_PROPOSAL_FAILED");
  await db.query("INSERT INTO audit_events(actor,action,target,approval_hash,meta) VALUES($1,'custom_ai_test_requested',$2,$3,$4::jsonb)",[actor,profile.id,exactPayloadHash(payload),JSON.stringify({version,operationId:payload.operationId,role})]);
  return {kind:"created",approvalId,payload} as const;
}
export function validateAiTestApproval(payload:unknown,payloadHash:string,profile:CustomAiProfileRow|null):{applied:true}|{applied:false;code:"APPROVAL_STALE"}{
  const parsed=aiTestApprovalSchema.safeParse(payload);
  if(!parsed.success||!profile||exactPayloadHash(payload)!==payloadHash)return {applied:false,code:"APPROVAL_STALE"};
  const grant=parsed.data,config=customAiProfileConfigFromRow(profile);
  if(grant.profileId!==profile.id||grant.version!==profile.version||grant.keyRevision!==profile.key_revision||!customAiProfileIsEligible(profile)||!config.roles.includes(grant.role)||grant.configFingerprint!==customAiProfileConfigFingerprint(profile)||exactPayloadHash(grant.displayedConfig)!==exactPayloadHash(config)||grant.maxCostUsd!==maximumAiRequestCostUsd(config))return {applied:false,code:"APPROVAL_STALE"};
  return {applied:true};
}
