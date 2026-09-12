import type { AiTestApproval } from "../../../packages/domain/src/ai-test.ts";
import { requestCustomAi, type AiRole, type CustomAiProfile } from "./custom-ai-api.ts";
export type AiTestRecord = {readonly id:string;readonly status:"pending"|"approved"|"rejected"|"stale";readonly payload:AiTestApproval;readonly createdAt:string;readonly execution:{readonly id:string;readonly state:string}|null};
export async function getAiTests(profileId:string):Promise<readonly AiTestRecord[]>{
  const response=await requestCustomAi(undefined,`/api/custom-ai/${profileId}/tests`);
  const body:{tests:AiTestRecord[]}=await response.json();return body.tests;
}
export async function proposeAiTest(profile:CustomAiProfile,role:AiRole):Promise<void>{
  await requestCustomAi({version:profile.version,role},`/api/custom-ai/${profile.id}/test-proposals`);
}

export async function runAiTest(record:AiTestRecord):Promise<void>{
  await requestCustomAi({},`/api/custom-ai/${record.payload.profileId}/tests/${record.id}/run`);
}
