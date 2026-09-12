import { materializeProposedSpec,reuseDifferentiationProposal } from "./automatic-spec.ts";
import { prepareCandidateAiTask, finishCandidateAiTask, type Pool } from "@forge-ops/db";
import type { AiBusinessInput } from "@forge-ops/domain";
import { executeApprovedAiBusiness } from "@forge-ops/integrations/ai/execute";
import type { AiTransport } from "@forge-ops/integrations/ai/transport";
import {readProductSource} from '@forge-ops/integrations/amazon/product-source';
export async function runCandidateAiWork(pool:Pool,candidateId:string,role:AiBusinessInput['role'],options:{transport:AiTransport;encryptionKey:Buffer}){
 if(role==='sourcing_analysis'){
  const reused=await reuseDifferentiationProposal(pool,candidateId);
  if(reused)return reused;
 }
 if(options.transport.kind==='disabled')return {kind:'disabled'} as const;
 const source=role==='niche_analysis'||role==='sourcing_analysis'?await readProductSource(pool,candidateId,options.encryptionKey):null;
 const task=await prepareCandidateAiTask(pool,candidateId,role,source?.state==='captured'&&source.reference.fragments.length?source.reference:undefined);
 if(!task)return {kind:'input_unavailable'} as const;
 const result=await executeApprovedAiBusiness(pool,{operationId:task.id,businessInput:task.input,encryptionKey:options.encryptionKey,createTransport:()=>options.transport});
 await finishCandidateAiTask(pool,task.id);
 if(role==='sourcing_analysis'||role==='niche_analysis')await materializeProposedSpec(pool,task.id);
 return result;
}
