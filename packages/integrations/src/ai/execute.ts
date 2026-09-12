import { aiBusinessMessages, parseAiBusinessOutput, type AiBusinessInput } from "@forge-ops/domain";
import { AI_TEST_PROMPT, aiTestApprovalSchema, customAiProviderActivationSchema, maximumAiRequestCostUsd } from "@forge-ops/domain";
import { prepareAiExecution, markAiAttemptDispatching, finalizeAiExecution, type Pool, type AiTestGrantCandidate, type AiExecutionRole, type AiExecutionMode, type AiReportedUsage, type AiAttemptFinalState } from "@forge-ops/db";
import { decryptSecret, exactPayloadHash } from "@forge-ops/security";
import type { AiTransport, AiWireResult } from "./transport.ts";
import {resolveAiProductSource} from '../amazon/product-source.ts';
type Input={readonly operationId:string;readonly role:AiExecutionRole;readonly mode:AiExecutionMode;readonly grantApprovalId?:string;readonly encryptionKey:Buffer;readonly createTransport:()=>AiTransport;readonly now?:Date;readonly clock?:()=>Date;readonly productEvidenceRequired?:boolean};
function verified(candidate:AiTestGrantCandidate,input:Input):boolean{
  const profile=candidate.profile;
  if(exactPayloadHash(candidate.payload)!==candidate.payloadHash)return false;
  const parsed=input.mode==='test'?aiTestApprovalSchema.safeParse(candidate.payload):customAiProviderActivationSchema.safeParse(candidate.payload);
  if(!parsed.success)return false;
  const grant=parsed.data;
  if(input.productEvidenceRequired&&(grant.purpose!=='activation'||grant.productEvidenceScope!=='short-excerpts-v1'))return false;
  if(grant.profileId!==profile.id||grant.version!==profile.version||grant.keyRevision!==profile.keyRevision||!profile.config.roles.includes(input.role)||exactPayloadHash(grant.displayedConfig)!==exactPayloadHash(profile.config)||grant.configFingerprint!==exactPayloadHash({config:profile.config,keyRevision:profile.keyRevision}))return false;
  if(grant.purpose==='test')return candidate.approvalId===input.grantApprovalId&&grant.operationId===input.operationId&&grant.role===input.role&&grant.maxCostUsd===maximumAiRequestCostUsd(profile.config);
  return input.mode==='activation-approved-only';
}
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function containsSecret(value:unknown,secret:string):boolean{
 if(typeof value==='string')return value.includes(secret);
 if(Array.isArray(value))return value.some(item=>containsSecret(item,secret));
 return object(value)&&Object.values(value).some(item=>containsSecret(item,secret));
}
function responseState(result:AiWireResult,maxInput:number,maxOutput:number,decode:(value:unknown)=>unknown|null):{state:AiAttemptFinalState;status:number|null;usage:AiReportedUsage;payload?:unknown}{
  const noUsage={known:false} as const;
  if(result.kind==='not_sent')return {state:'failed_non_dispatch',status:null,usage:noUsage};
  if(result.kind==='unknown')return {state:'outcome_unknown',status:null,usage:noUsage};
  let usage:AiReportedUsage=noUsage;
  if(object(result.body)&&object(result.body.usage)){
    const reported=result.body.usage,prompt=reported.prompt_tokens,completion=reported.completion_tokens;
    if(typeof prompt==='number'&&typeof completion==='number'&&Number.isSafeInteger(prompt)&&Number.isSafeInteger(completion)&&prompt>=0&&completion>=0&&prompt<=maxInput&&completion<=maxOutput)usage={known:true,inputTokens:prompt,outputTokens:completion};
  }
  if(result.status<200||result.status>=300)return {state:'failed_dispatched',status:result.status,usage};
  if(!object(result.body)||!Array.isArray(result.body.choices)||result.body.choices.length!==1)return {state:'failed_dispatched',status:result.status,usage};
  const choice:unknown=result.body.choices[0];
  if(!object(choice)||!object(choice.message)||typeof choice.message.content!=='string'||choice.message.content.length>12000)return {state:'failed_dispatched',status:result.status,usage};
  try{const parsed:unknown=JSON.parse(choice.message.content);const payload=decode(parsed);return {state:payload!==null?'succeeded':'failed_dispatched',status:result.status,usage,payload};}
  catch{return {state:'failed_dispatched',status:result.status,usage};}
}
type RequestMessages=readonly {readonly role:'system'|'user';readonly content:string}[];
async function executeAiRequest(pool:Pool,input:Input,messages:RequestMessages|(()=>Promise<RequestMessages|null>),decode:(value:unknown)=>unknown|null){
  const now=()=>input.clock?.()??input.now??new Date();
  for(;;){
    const db=await pool.connect();
    let prepared;
    try{
      await db.query('BEGIN');
      prepared=await prepareAiExecution(db,{...input,now:now(),verifyApproval:candidate=>verified(candidate,input)});
      if(prepared.kind==='dispatch_ready'){
        if(!await markAiAttemptDispatching(db,prepared.attemptId))throw new Error('AI_DISPATCH_NOT_AUTHORIZED');
      }
      await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
    if(prepared.kind!=='dispatch_ready')return prepared;
    let result:AiWireResult;
    let secretToSuppress:string|undefined;
    try{
      const transport=now().toISOString().slice(0,10)!==prepared.budgetDay?{kind:'disabled'} as const:input.createTransport();
      if(transport.kind==='disabled')result={kind:'not_sent',code:'TRANSPORT_DISABLED'};
      else{
        let apiKey:string;
        try{apiKey=decryptSecret(prepared.profile.apiKeyCiphertext,input.encryptionKey,`custom-ai:${prepared.profile.id}:key`).toString('utf8');secretToSuppress=apiKey;}
        catch{result={kind:'not_sent',code:'CREDENTIAL_UNAVAILABLE'};apiKey='';}
        const requestMessages=apiKey?(typeof messages==='function'?await messages():messages):null;
        result=apiKey&&requestMessages?await transport.send({baseUrl:prepared.profile.config.baseUrl,model:prepared.profile.config.model,apiKey,maxInputTokens:prepared.profile.config.maxInputTokens,maxOutputTokens:prepared.profile.config.maxOutputTokens,messages:requestMessages}):{kind:'not_sent',code:apiKey?'SOURCE_UNAVAILABLE':'CREDENTIAL_UNAVAILABLE'};
      }
    }catch{result={kind:'unknown',code:'PROVIDER_OUTCOME_UNKNOWN'};}
    const parsedOutcome=responseState(result,prepared.profile.config.maxInputTokens,prepared.profile.config.maxOutputTokens,decode);
    const outcome=secretToSuppress && parsedOutcome.payload && containsSecret(parsedOutcome.payload,secretToSuppress)?{...parsedOutcome,state:"failed_dispatched" as const,payload:null}:parsedOutcome;
    const final=await pool.connect();
    try{await final.query('BEGIN');const finalized=await finalizeAiExecution(final,{attemptId:prepared.attemptId,state:outcome.state,providerStatus:outcome.status,usage:outcome.usage,resultPayload:outcome.payload});await final.query('COMMIT');if(!finalized)return {kind:'outcome_unknown',operationId:input.operationId,profileId:prepared.profile.id} as const;}
    catch(error){await final.query('ROLLBACK');throw error;}finally{final.release();}
    if(outcome.state==='failed_non_dispatch'&&input.mode==='activation-approved-only')continue;
    return {kind:outcome.state,operationId:input.operationId,profileId:prepared.profile.id};
  }
}

export async function executeApprovedSyntheticAiTest(pool:Pool,input:Input){
 return executeAiRequest(pool,input,[{role:'user',content:AI_TEST_PROMPT}],value=>object(value)&&Object.keys(value).length===1&&value.forge_test==='ok'?{forge_test:'ok'}:null);
}
export async function executeApprovedAiBusiness(pool:Pool,input:Omit<Input,'role'|'mode'|'grantApprovalId'>&{readonly businessInput:AiBusinessInput}){
 const source=input.businessInput.productSource;
 const messages=source?async()=>{
  const task=(await pool.query<{candidate_id:string}>("SELECT candidate_id FROM ai_business_tasks WHERE id=$1 AND input_payload=$2::jsonb",[input.operationId,JSON.stringify(input.businessInput)])).rows[0];
  if(!task)return null;
  const excerpts=await resolveAiProductSource(pool,task.candidate_id,source,input.encryptionKey);
  return excerpts?aiBusinessMessages(input.businessInput,excerpts):null;
 }:aiBusinessMessages(input.businessInput);
 return executeAiRequest(pool,{...input,role:input.businessInput.role,mode:'activation-approved-only',productEvidenceRequired:source!==undefined},messages,value=>parseAiBusinessOutput(value,input.businessInput));
}
