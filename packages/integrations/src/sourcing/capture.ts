import { createHash, createPublicKey, verify } from 'node:crypto';
import { lockSourcingContext, type Pool, type QueryConnection, type AlibabaConversationRow, type AlibabaActionRow, type AlibabaMessageRow } from "@forge-ops/db";
import { supplierCaptureSchema, browserTaskSchema, browserObservationSchema, BROWSER_TASK_SIGNATURE_PREFIX } from "@forge-ops/domain";
import { decryptSecret, exactPayloadHash } from '@forge-ops/security';
import { alibabaCompanyKey, alibabaProductKey } from './identity.ts';
import { insertSupplierCapture } from "./capture-store.ts";
export { insertSupplierCapture } from "./capture-store.ts";

export async function persistSupplierCapture(pool: Pool, input: {
 readonly capture: unknown; readonly encryptionKey: Buffer;
}) {
 const parsed=supplierCaptureSchema.safeParse(input.capture);
 if(!parsed.success||Date.parse(parsed.data.observedAt)>Date.now())return {kind:"invalid" as const};
 const capture=parsed.data,db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const spec=await lockSourcingContext(db,capture.candidateId);
  if(!spec||spec.input_version!==capture.inputVersion||spec.settings_version!==capture.settingsVersion||spec.spec_id!==capture.specId){
   await db.query("COMMIT");return {kind:"stale" as const};
  }
  const result=await insertSupplierCapture(db,{capture,encryptionKey:input.encryptionKey,spec});
  if(result.kind==="stored")await db.query("UPDATE candidates SET blocked_reason=NULL,last_progress_at=now() WHERE id=$1 AND blocked_reason='web_session'",[capture.candidateId]);
  await db.query("COMMIT");return result;
 }catch(error){await db.query("ROLLBACK");throw error;}
 finally{db.release();}
}

export { alibabaCompanyKey, alibabaProductKey } from "./identity.ts";

// Historical pre-dispatch evidence excludes obsolete allocations, never their inbound reservations.
export async function alibabaStaleDraftIds(db:QueryConnection,conversation:AlibabaConversationRow,actions:readonly AlibabaActionRow[],messages:readonly AlibabaMessageRow[],encryptionKey:Buffer):Promise<Set<string>> {
 const ids=new Set<string>(),hash=(body:string)=>createHash('sha256').update(body).digest('hex');
 const candidates=actions.filter(a=>a.kind==='followup'&&a.state==='blocked'&&a.reason==='NEGOTIATION_CONTEXT_CHANGED'&&a.started_at===null&&a.dispatch_task_id===null&&a.sent_message_id===null);
 if(!candidates.length||!conversation.account_id||!conversation.provider_thread_id||conversation.reason==='MESSAGE_IDENTITY_CONFLICT')return ids;
 const identity=(await db.query<{public_key:string}>('SELECT public_key FROM browser_signing_identity WHERE singleton=1')).rows[0];
 if(!identity)return ids;
 type EvidenceTask={id:string|null;task_id:string;receipt_task_id:string|null;result_id:string|null;action_id:string|null;device_id:string;candidate_id:string;conversation_id:string;spec_id:string|null;input_version:number;settings_version:number;task_kind:string;state:string;first_delivered_at:Date|null;delivered_at:Date|null;has_result:boolean;task_hash:string;envelope:{payload:string;signature:string};expires_at:Date;body_ciphertext:string|null;body_sha256:string|null};
 const columns='t.id AS task_id,t.result_id,t.action_id,t.device_id,t.candidate_id,t.conversation_id,t.spec_id,t.input_version,t.settings_version,t.task_kind,t.state,t.first_delivered_at,t.delivered_at,t.task_hash,t.envelope,t.expires_at,r.id,r.task_id AS receipt_task_id,r.body_ciphertext,r.body_sha256';
 const tasks=(await db.query<EvidenceTask>(`SELECT ${columns},EXISTS(SELECT 1 FROM browser_task_results any_result WHERE any_result.task_id=t.id) AS has_result
  FROM browser_tasks t LEFT JOIN browser_task_results r ON r.task_id=t.id AND r.id=t.result_id
  WHERE t.conversation_id=$1 AND t.action_id=ANY($2::uuid[]) AND t.task_kind='supplier_send' AND t.state IN ('completed','cancelled')
   AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.action='alibaba_send_started' AND e.target=t.action_id::text)`,[conversation.id,candidates.map(a=>a.id)])).rows;
 const reads=tasks.some(t=>t.state==='cancelled')?(await db.query<EvidenceTask>(`SELECT ${columns},true AS has_result FROM browser_tasks t JOIN browser_task_results r ON r.task_id=t.id AND r.id=t.result_id
  WHERE t.conversation_id=$1 AND t.task_kind='supplier_thread' AND t.state='completed' AND r.id=ANY($2::uuid[])`,[conversation.id,messages.filter(m=>m.direction==='inbound').map(m=>m.receipt_id)])).rows:[];
 const signed=(row:EvidenceTask)=>{
  const task=browserTaskSchema.parse(JSON.parse(Buffer.from(row.envelope.payload,'base64url').toString('utf8'))),request=task.request;
  if(task.id!==row.task_id||task.deviceId!==row.device_id||hash(row.envelope.payload)!==row.task_hash||!verify(null,Buffer.from(BROWSER_TASK_SIGNATURE_PREFIX+row.envelope.payload),createPublicKey(identity.public_key),Buffer.from(row.envelope.signature,'base64url'))||Date.parse(task.expiresAt)!==row.expires_at.getTime())return null;
  if((request.kind!=='supplier_send'&&request.kind!=='supplier_thread')||request.kind!==row.task_kind||request.conversationId!==conversation.id||row.conversation_id!==conversation.id||request.candidateId!==conversation.candidate_id||row.candidate_id!==conversation.candidate_id||request.specId!==conversation.spec_id||row.spec_id!==conversation.spec_id||request.inputVersion!==conversation.input_version||row.input_version!==conversation.input_version||request.settingsVersion!==conversation.settings_version||row.settings_version!==conversation.settings_version||request.accountId!==conversation.account_id||request.threadId!==conversation.provider_thread_id||request.companyName!==conversation.company_name||request.companyUrl!==conversation.company_url||request.productUrl!==conversation.product_url)return null;
  return task;
 };
 for(const action of candidates){
  const inbound=messages.find(m=>m.id===action.inbound_message_id&&m.direction==='inbound');
  if(!inbound||action.candidate_id!==conversation.candidate_id||action.spec_id!==conversation.spec_id||action.input_version!==conversation.input_version||action.settings_version!==conversation.settings_version||messages.some(m=>m.direction==='outbound'&&m.body_sha256===action.body_sha256))continue;
  for(const send of tasks.filter(t=>t.action_id===action.id))try{
   const task=signed(send),request=task?.request;
   if(!task||request?.kind!=='supplier_send'||request.actionId!==action.id||!['completed','cancelled'].includes(send.state))continue;
   if(hash(request.body)!==action.body_sha256||request.body!==decryptSecret(action.body_ciphertext,encryptionKey,'alibaba-action:'+action.id).toString('utf8')||request.basedOnInbound?.providerMessageId!==inbound.provider_message_id||Date.parse(request.basedOnInbound.sentAt)!==inbound.sent_at.getTime()||request.basedOnInbound.bodySha256!==inbound.body_sha256)continue;
   if(send.state==='cancelled'&&(send.first_delivered_at!==null||send.delivered_at!==null||send.result_id!==null||send.has_result))continue;
   const proofs=send.state==='completed'?[send]:reads;
   for(const receipt of proofs)try{
    const proof=signed(receipt);
    if(!proof||receipt.state!=='completed'||!receipt.id||receipt.id!==receipt.result_id||receipt.receipt_task_id!==receipt.task_id||!receipt.body_ciphertext)continue;
    const observation=browserObservationSchema.parse(JSON.parse(decryptSecret(receipt.body_ciphertext,encryptionKey,'browser-task-result:'+receipt.id).toString('utf8')));
    if(exactPayloadHash(observation)!==receipt.body_sha256||observation.scope!=='alibaba_thread'||observation.conversationId!==conversation.id||observation.accountId!==conversation.account_id||observation.threadId!==conversation.provider_thread_id||alibabaCompanyKey(observation.companyUrl)!==conversation.company_key||alibabaProductKey(observation.productUrl)!==alibabaProductKey(conversation.product_url))continue;
    if(send.state==='completed'?(observation.sendStatus!=='not_sent'||!['NEGOTIATION_CONTEXT_CHANGED','SOURCE_CHANGED'].includes(observation.reason??'')||observation.actionId!==action.id):(proof.request.kind!=='supplier_thread'||receipt.action_id!==null||observation.sendStatus!=='read'||observation.reason!==null||observation.actionId!==null))continue;
    const observed=Date.parse(observation.observedAt),incoming=observation.messages.filter(m=>m.direction==='inbound');
    if(observed<Date.parse(proof.issuedAt)||observed>Date.parse(proof.expiresAt)||observed>Date.now())continue;
    if(!incoming.some(m=>m.id===inbound.provider_message_id)||!incoming.some(m=>Date.parse(m.sentAt)>inbound.sent_at.getTime()&&(send.state==='completed'||messages.some(saved=>saved.provider_message_id===m.id&&saved.receipt_id===receipt.id)))||observation.messages.some(m=>Date.parse(m.sentAt)>observed||(m.direction==='outbound'&&(Date.parse(m.sentAt)>=inbound.sent_at.getTime()||hash(m.body)===action.body_sha256))))continue;
    if(observation.messages.some(m=>!messages.some(saved=>saved.provider_message_id===m.id&&saved.direction===m.direction&&saved.sent_at.getTime()===Date.parse(m.sentAt)&&saved.body_sha256===hash(m.body))))continue;
    ids.add(action.id);break;
   }catch{continue;}
   if(ids.has(action.id))break;
  }catch{continue;}
 }
 return ids;
}
