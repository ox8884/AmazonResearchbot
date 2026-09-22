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

// A niche proposal counts as differentiation evidence only when it cites customer reviews of the representative
// product (parseAiBusinessOutput already checks the refs); seller feature claims alone never pass. It is an AI
// estimate for the current candidate version. Returns whether new evidence was recorded.
export async function recordDifferentiationEvidence(pool:Pool,candidateId:string):Promise<boolean>{
 const row=(await pool.query<{id:string;input_version:number;settings_version:number;proposal:{status?:unknown;reviewRefs?:unknown}|null}>(
  `SELECT t.id,t.input_version,t.settings_version,o.result_payload->'differentiationProposal' AS proposal
   FROM ai_business_tasks t JOIN ai_execution_operations o ON o.id=t.id JOIN candidates c ON c.id=t.candidate_id
   WHERE t.candidate_id=$1 AND t.role='niche_analysis' AND o.state='succeeded' AND t.input_version=c.input_version
     AND t.settings_version=(SELECT max(version) FROM settings_versions)
   ORDER BY t.created_at DESC LIMIT 1`,[candidateId])).rows[0];
 const reviewRefs=row?.proposal?.reviewRefs;
 if(!row||row.proposal?.status!=='proposed'||!Array.isArray(reviewRefs)||!reviewRefs.length)return false;
 const inserted=await pool.query(`INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at,input_version,settings_version)
   SELECT $1,'differentiation','estimate','true',$2,now(),$3,$4
   WHERE NOT EXISTS(SELECT 1 FROM evidence WHERE candidate_id=$1 AND field='differentiation' AND source_id=$2)`,
  [candidateId,'ai-business-task:'+row.id,row.input_version,row.settings_version]);
 return (inserted.rowCount??0)>0;
}
