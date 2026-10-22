import {createHash,createPublicKey,randomUUID,verify,type KeyObject} from 'node:crypto';
import {lockActiveBridgeDevice,lockAlibabaContext,registerAlibabaCompanies,refreshAlibabaStage,recoverAlibabaOutcomes,type Pool,type AlibabaContext,type AlibabaConversationRow,type AlibabaActionRow,type AlibabaMessageRow} from '@forge-ops/db';
import {decryptSecret,encryptSecret,exactPayloadHash} from '@forge-ops/security';
import {alibabaBindingRequest,alibabaNegotiationContextSchema,alibabaNonbinding,browserObservationSchema,browserTaskSchema,BROWSER_TASK_SIGNATURE_PREFIX,MAX_BROWSER_TASK_BYTES,type AlibabaMessageAnchor,type AlibabaNegotiationContext,type BrowserReadTask} from '@forge-ops/domain';
import {alibabaCompanyKey,alibabaProductKey,alibabaStaleDraftIds} from '@forge-ops/integrations/sourcing/capture';
import {signBrowserTask} from './browser-task-signer.ts';

const hash=(body:string)=>createHash('sha256').update(body).digest('hex');
const anchor=(message:AlibabaMessageRow):AlibabaMessageAnchor=>({providerMessageId:message.provider_message_id,sentAt:message.sent_at.toISOString(),bodySha256:message.body_sha256});
const specification=(source:AlibabaContext)=>source.spec_id?`Requested specifications (please confirm feasibility): material ${source.material}; dimensions ${source.dimensions}; packaging ${source.packaging}; requirements ${source.requirements}.`:'Specifications are not finalized. Please describe your available materials, product dimensions, packaged dimensions/weight, packaging, and customization options; do not assume a final specification.';
type Signing={origin:string;privateKey:KeyObject;fingerprint:string};
export const ALIBABA_AI_FORMAT_FIX_SHA256='f9e1ad47cb7846000d163477c879e5572eddbecbc772d11459b0f3690250b1de';
const aiFormatIncident='alibaba-json-string-whitespace-20260930';
type TaskTarget={deviceId:string;conversationId:string;actionId?:string;encryptionKey:Buffer;recoveryRead?:true;recovery?:{notSentReceiptId:string;readReceiptId:string};aiRecovery?:{inboundMessageId:string;failureReceiptId:string;fixHash:string}};
type RecoveryReceipt={id:string;task_id:string;task_kind:string;action_id:string|null;task_hash:string;envelope:{payload:string;signature:string};body_ciphertext:string;body_sha256:string;created_at:Date;task_created_at:Date};

async function aiIncidentEvidence(db:Pick<Pool,'query'>,target:TaskTarget,conversation:AlibabaConversationRow,signing:Signing){
 const recovery=target.aiRecovery;
 if(!recovery||recovery.fixHash!==ALIBABA_AI_FORMAT_FIX_SHA256||target.actionId||target.recovery||target.recoveryRead||conversation.status!=='attention'||conversation.reason!=='AI_RESPONSE_INVALID'||!conversation.account_id||!conversation.provider_thread_id)return null;
 const gate=await lockAlibabaContext(db,conversation.candidate_id);
 if(!gate.ready||gate.source.spec_id!==conversation.spec_id||gate.source.input_version!==conversation.input_version||gate.source.settings_version!==conversation.settings_version)return null;
 const retained=(await db.query<{task_id:string;action_id:string;message_id:string;receipt_id:string;receipt_task_id:string;reconciled:boolean}>(`SELECT t.id AS task_id,a.id AS action_id,m.id AS message_id,r.id AS receipt_id,rt.id AS receipt_task_id,
  (t.state='delivered' AND t.task_kind='supplier_send' AND t.expires_at<=clock_timestamp() AND rt.id IS NOT NULL) AS reconciled
  FROM browser_tasks t LEFT JOIN alibaba_actions a ON a.id=t.action_id AND a.dispatch_task_id=t.id
   AND a.conversation_id=t.conversation_id AND a.state='sent' AND a.started_at IS NOT NULL
  LEFT JOIN alibaba_messages m ON m.id=a.sent_message_id AND m.conversation_id=a.conversation_id
   AND m.direction='outbound' AND m.body_sha256=a.body_sha256 AND m.sent_at>=a.started_at-interval '5 seconds'
  LEFT JOIN browser_task_results r ON r.id=m.receipt_id
  LEFT JOIN browser_tasks rt ON rt.id=r.task_id AND rt.result_id=r.id AND rt.state='completed' AND rt.conversation_id=t.conversation_id
  WHERE t.conversation_id=$1 AND t.state IN ('queued','delivered')`,[conversation.id])).rows;
 if(retained.some(task=>!task.reconciled))return null;
 if((await db.query("SELECT 1 FROM audit_events WHERE action='alibaba_ai_incident_admission' AND target=$1 AND meta->>'incident'=$2 AND meta->>'inboundMessageId'=$3",[conversation.id,aiFormatIncident,recovery.inboundMessageId])).rowCount)return null;
 const retries=(await db.query<{count:number}>("SELECT count(*)::int AS count FROM audit_events WHERE action='alibaba_ai_retry' AND target=$1 AND meta->>'inboundMessageId'=$2",[conversation.id,recovery.inboundMessageId])).rows[0]?.count;
 if(retries!==2)return null;
 const actions=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE conversation_id=$1',[conversation.id])).rows;
 const messages=(await db.query<AlibabaMessageRow>('SELECT * FROM alibaba_messages WHERE conversation_id=$1 ORDER BY sent_at DESC,provider_message_id DESC',[conversation.id])).rows;
 const obsolete=await alibabaStaleDraftIds(db,conversation,actions,messages,target.encryptionKey),counted=actions.filter(a=>!obsolete.has(a.id));
 const round=counted.filter(action=>action.kind==='followup').length+1;
 if(!counted.length||counted.some(action=>action.state!=='sent')||round>3)return null;
 const inbound=messages.find(message=>message.direction==='inbound'),outbound=messages.find(message=>message.direction==='outbound');
 if(!inbound||!outbound||inbound.id!==recovery.inboundMessageId||inbound.sent_at<=outbound.sent_at||!actions.some(action=>action.sent_message_id===outbound.id)||actions.some(action=>action.inbound_message_id===inbound.id))return null;
 const context=alibabaNegotiationContextSchema.safeParse({keyword:gate.source.keyword_display,specification:specification(gate.source),lastOutbound:anchor(outbound),round});
 if(!context.success)return null;
 const receipt=(await db.query<RecoveryReceipt&{device_id:string;candidate_id:string;spec_id:string|null;input_version:number;settings_version:number;result_id:string}>(`SELECT r.*,t.id AS task_id,t.task_kind,t.action_id,t.task_hash,t.envelope,t.created_at AS task_created_at,
  t.device_id,t.candidate_id,t.spec_id,t.input_version,t.settings_version,t.result_id FROM browser_tasks t
  JOIN browser_task_results r ON r.id=t.result_id AND r.task_id=t.id
  WHERE t.conversation_id=$1 AND t.task_kind='supplier_thread' AND t.state='completed'
  ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,[conversation.id])).rows[0];
 if(!receipt||receipt.id!==recovery.failureReceiptId||receipt.result_id!==receipt.id||receipt.device_id!==target.deviceId||receipt.action_id!==null||receipt.candidate_id!==conversation.candidate_id||receipt.spec_id!==conversation.spec_id||receipt.input_version!==conversation.input_version||receipt.settings_version!==conversation.settings_version)return null;
 try{
  if(messages.some(message=>message.direction==='inbound'&&message.sent_at>outbound.sent_at&&alibabaBindingRequest.test(decryptSecret(message.body_ciphertext,target.encryptionKey,'alibaba-message:'+message.id).toString('utf8'))))return null;
  const observation=browserObservationSchema.parse(JSON.parse(decryptSecret(receipt.body_ciphertext,target.encryptionKey,'browser-task-result:'+receipt.id).toString('utf8')));
  const task=browserTaskSchema.parse(JSON.parse(Buffer.from(receipt.envelope.payload,'base64url').toString('utf8'))),request=task.request;
  if(exactPayloadHash(observation)!==receipt.body_sha256||hash(receipt.envelope.payload)!==receipt.task_hash||!verify(null,Buffer.from(BROWSER_TASK_SIGNATURE_PREFIX+receipt.envelope.payload),createPublicKey(signing.privateKey),Buffer.from(receipt.envelope.signature,'base64url'))||task.id!==receipt.task_id||task.deviceId!==target.deviceId||task.issuerOrigin!==signing.origin)return null;
  if(request.kind!=='supplier_thread'||request.conversationId!==conversation.id||request.candidateId!==conversation.candidate_id||request.specId!==conversation.spec_id||request.inputVersion!==conversation.input_version||request.settingsVersion!==conversation.settings_version||request.accountId!==conversation.account_id||request.threadId!==conversation.provider_thread_id||request.companyUrl!==conversation.company_url||request.productUrl!==conversation.product_url||exactPayloadHash(request.negotiation??null)!==exactPayloadHash(context.data))return null;
  if(observation.kind!=='captured'||observation.scope!=='alibaba_thread'||observation.sendStatus!=='read'||observation.reason!==null||observation.actionId!==null||observation.conversationId!==conversation.id||observation.accountId!==conversation.account_id||observation.threadId!==conversation.provider_thread_id||alibabaCompanyKey(observation.companyUrl)!==conversation.company_key||alibabaProductKey(observation.productUrl)!==alibabaProductKey(conversation.product_url))return null;
  const observed=Date.parse(observation.observedAt),proposal=observation.proposal;
  if(observed<Date.parse(task.issuedAt)||observed>Date.parse(task.expiresAt)||observed>Date.now()||!proposal||proposal.decision.kind!=='review'||proposal.decision.reason!=='AI_RESPONSE_INVALID'||exactPayloadHash(proposal.basedOnInbound)!==exactPayloadHash(anchor(inbound)))return null;
  for(const expected of [inbound,outbound]){
   const latest=observation.messages.filter(message=>message.direction===expected.direction).sort((a,b)=>Date.parse(b.sentAt)-Date.parse(a.sentAt)||b.id.localeCompare(a.id))[0];
   if(!latest||latest.id!==expected.provider_message_id||Date.parse(latest.sentAt)!==expected.sent_at.getTime()||hash(latest.body)!==expected.body_sha256)return null;
  }
 }catch{return null;}
 return {negotiation:context.data,meta:{incident:aiFormatIncident,originalReason:conversation.reason,previousRetryCount:retries,inboundMessageId:inbound.id,inbound:anchor(inbound),outboundMessageId:outbound.id,outbound:anchor(outbound),failureReceiptId:receipt.id,failureTaskId:receipt.task_id,failureReceiptHash:receipt.body_sha256,failureTaskHash:receipt.task_hash,deviceId:target.deviceId,candidateId:conversation.candidate_id,specId:conversation.spec_id,inputVersion:conversation.input_version,settingsVersion:conversation.settings_version,fixHash:recovery.fixHash,retainedSentTasks:retained.map(task=>({taskId:task.task_id,actionId:task.action_id,messageId:task.message_id,receiptId:task.receipt_id,receiptTaskId:task.receipt_task_id}))}};
}

async function recoveryEvidence(db:Pick<Pool,'query'>,target:TaskTarget,conversation:AlibabaConversationRow,action:AlibabaActionRow,signing:Signing):Promise<boolean>{
 if(!target.recovery||action.kind!=='followup'||action.state!=='blocked'||action.reason!=='NEGOTIATION_CONTEXT_CHANGED'||action.started_at||action.dispatch_task_id||action.sent_message_id||conversation.status!=='attention'||conversation.reason!=='NEGOTIATION_CONTEXT_CHANGED')return false;
 const receipts=(await db.query<RecoveryReceipt>(`SELECT r.*,t.id AS task_id,t.task_kind,t.action_id,t.task_hash,t.envelope,t.created_at AS task_created_at
  FROM browser_task_results r JOIN browser_tasks t ON t.result_id=r.id AND t.id=r.task_id
  WHERE r.id=ANY($1::uuid[]) AND t.state='completed' AND t.device_id=$2 AND t.conversation_id=$3
   AND t.candidate_id=$4 AND t.spec_id IS NOT DISTINCT FROM $5::uuid AND t.input_version=$6 AND t.settings_version=$7`,
  [[target.recovery.notSentReceiptId,target.recovery.readReceiptId],target.deviceId,conversation.id,action.candidate_id,action.spec_id,action.input_version,action.settings_version])).rows;
 const failed=receipts.find(r=>r.id===target.recovery?.notSentReceiptId),read=receipts.find(r=>r.id===target.recovery?.readReceiptId);
 if(!failed||!read||failed.id===read.id||failed.task_kind!=='supplier_send'||failed.action_id!==action.id||read.task_kind!=='supplier_thread'||read.action_id!==null||read.task_created_at<=failed.created_at||read.created_at<=failed.created_at||read.created_at.getTime()<Date.now()-300000)return false;
 const messages=(await db.query<AlibabaMessageRow>('SELECT * FROM alibaba_messages WHERE conversation_id=$1 ORDER BY sent_at DESC,provider_message_id DESC',[conversation.id])).rows;
 const inbound=messages.find(m=>m.direction==='inbound');
 if(!inbound||inbound.id!==action.inbound_message_id||messages.some(m=>m.direction==='outbound'&&m.sent_at>=inbound.sent_at))return false;
 const actions=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE conversation_id=$1',[conversation.id])).rows;
 const obsolete=await alibabaStaleDraftIds(db,conversation,actions,messages,target.encryptionKey);
 if(actions.some(a=>a.id!==action.id&&a.state!=='sent'&&!obsolete.has(a.id)))return false;
 try{
  for(const receipt of [failed,read]){
   const observation=browserObservationSchema.parse(JSON.parse(decryptSecret(receipt.body_ciphertext,target.encryptionKey,'browser-task-result:'+receipt.id).toString('utf8')));
   const task=browserTaskSchema.parse(JSON.parse(Buffer.from(receipt.envelope.payload,'base64url').toString('utf8'))),request=task.request;
   if(exactPayloadHash(observation)!==receipt.body_sha256||hash(receipt.envelope.payload)!==receipt.task_hash||!verify(null,Buffer.from(BROWSER_TASK_SIGNATURE_PREFIX+receipt.envelope.payload),createPublicKey(signing.privateKey),Buffer.from(receipt.envelope.signature,'base64url'))||task.id!==receipt.task_id||task.deviceId!==target.deviceId||task.issuerOrigin!==signing.origin)return false;
   if((request.kind!=='supplier_send'&&request.kind!=='supplier_thread')||request.kind!==receipt.task_kind||request.conversationId!==conversation.id||request.candidateId!==action.candidate_id||request.specId!==action.spec_id||request.inputVersion!==action.input_version||request.settingsVersion!==action.settings_version||request.accountId!==conversation.account_id||request.threadId!==conversation.provider_thread_id||request.companyUrl!==conversation.company_url||request.productUrl!==conversation.product_url)return false;
   if(observation.scope!=='alibaba_thread'||observation.kind!=='captured'||observation.conversationId!==conversation.id||observation.accountId!==conversation.account_id||observation.threadId!==conversation.provider_thread_id||alibabaCompanyKey(observation.companyUrl)!==conversation.company_key||alibabaProductKey(observation.productUrl)!==alibabaProductKey(conversation.product_url))return false;
   const observed=Date.parse(observation.observedAt);
   if(observed<Date.parse(task.issuedAt)||observed>Date.parse(task.expiresAt)||observed>Date.now())return false;
   if(request.kind==='supplier_send'){
    if(observation.actionId!==action.id||observation.sendStatus!=='not_sent'||observation.reason!=='NEGOTIATION_CONTEXT_CHANGED'||request.actionId!==action.id||hash(request.body)!==action.body_sha256||exactPayloadHash(request.basedOnInbound??null)!==exactPayloadHash(anchor(inbound)))return false;
   }else{
    if(observation.actionId!==null||observation.sendStatus!=='read'||observation.reason!==null||request.negotiation||Date.parse(task.issuedAt)<=failed.created_at.getTime()||observed<=failed.created_at.getTime()||observed<Date.now()-300000)return false;
    const latest=observation.messages.filter(m=>m.direction==='inbound').sort((a,b)=>Date.parse(b.sentAt)-Date.parse(a.sentAt)||b.id.localeCompare(a.id))[0];
    if(!latest||latest.id!==inbound.provider_message_id||Date.parse(latest.sentAt)!==inbound.sent_at.getTime()||hash(latest.body)!==inbound.body_sha256||observation.messages.some(m=>m.direction==='outbound'&&Date.parse(m.sentAt)>=inbound.sent_at.getTime()))return false;
   }
  }
 }catch{return false;}
 return true;
}

async function recoverAlibabaAi(db:Pick<Pool,'query'>,encryptionKey:Buffer) {
 const conversations=(await db.query<AlibabaConversationRow>(`SELECT * FROM alibaba_conversations
  WHERE status='attention' AND reason IN ('AI_UNAVAILABLE','AI_RESPONSE_INVALID')
   AND (next_check_at IS NULL OR next_check_at<=clock_timestamp()) ORDER BY created_at,id FOR UPDATE`)).rows;
 for(const conversation of conversations){
  const gate=await lockAlibabaContext(db,conversation.candidate_id);
  if(!gate.ready||gate.source.spec_id!==conversation.spec_id||gate.source.input_version!==conversation.input_version||gate.source.settings_version!==conversation.settings_version||!conversation.account_id||!conversation.provider_thread_id)continue;
  const actions=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE conversation_id=$1',[conversation.id])).rows;
  const messages=(await db.query<AlibabaMessageRow>('SELECT * FROM alibaba_messages WHERE conversation_id=$1 ORDER BY sent_at DESC,provider_message_id DESC',[conversation.id])).rows;
  const obsolete=await alibabaStaleDraftIds(db,conversation,actions,messages,encryptionKey),counted=actions.filter(a=>!obsolete.has(a.id));
  if(!counted.length||counted.some(action=>action.state!=='sent'))continue;
  const outbound=messages.find(message=>message.direction==='outbound'),inbound=messages.find(message=>message.direction==='inbound');
  if(!outbound||!actions.some(action=>action.sent_message_id===outbound.id)||!inbound||inbound.sent_at<=outbound.sent_at||actions.some(action=>action.inbound_message_id===inbound.id))continue;
  const attempts=(await db.query<{count:number}>("SELECT count(*)::int AS count FROM audit_events WHERE action='alibaba_ai_retry' AND target=$1 AND meta->>'inboundMessageId'=$2",[conversation.id,inbound.id])).rows[0]?.count??0;
  if(attempts>=2){await db.query('UPDATE alibaba_conversations SET next_check_at=NULL WHERE id=$1',[conversation.id]);continue;}
  await db.query("UPDATE alibaba_conversations SET status='awaiting_reply',reason=NULL WHERE id=$1",[conversation.id]);
  await db.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:alibaba','alibaba_ai_retry',$1,$2::jsonb)",[conversation.id,JSON.stringify({inboundMessageId:inbound.id})]);
  await refreshAlibabaStage(db,conversation.candidate_id);
 }
}

export async function prepareAlibabaActions(pool:Pool,encryptionKey:Buffer):Promise<number> {
 const db=await pool.connect();let created=0;
 try {
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  await recoverAlibabaOutcomes(db);
  await recoverAlibabaAi(db,encryptionKey);
  const conversations=(await db.query<AlibabaConversationRow>("SELECT * FROM alibaba_conversations WHERE status IN ('queued','awaiting_reply','negotiating') OR (status='attention' AND reason='NEGOTIATION_CONTEXT_CHANGED') ORDER BY created_at,id FOR UPDATE")).rows;
  for(const conversation of conversations){
   const gate=await lockAlibabaContext(db,conversation.candidate_id);
   const current=gate.ready&&gate.source.spec_id===conversation.spec_id&&gate.source.input_version===conversation.input_version&&gate.source.settings_version===conversation.settings_version;
   if(!current){
    if(conversation.status==='attention')continue;
    await db.query("UPDATE alibaba_actions SET state='cancelled',reason='SOURCE_CHANGED' WHERE conversation_id=$1 AND state='pending'",[conversation.id]);
    await db.query("UPDATE alibaba_conversations SET status='paused',reason=$2 WHERE id=$1",[conversation.id,gate.ready?'SOURCE_CHANGED':gate.reason]);continue;
   }
   if(!conversation.provider_thread_id||!conversation.account_id)continue;
   const actions=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE conversation_id=$1 ORDER BY created_at,id',[conversation.id])).rows;
   const messages=(await db.query<AlibabaMessageRow>('SELECT * FROM alibaba_messages WHERE conversation_id=$1 ORDER BY sent_at DESC,provider_message_id DESC',[conversation.id])).rows;
   const obsolete=await alibabaStaleDraftIds(db,conversation,actions,messages,encryptionKey),counted=actions.filter(a=>!obsolete.has(a.id));
   if(counted.some(action=>action.state!=='sent'))continue;
   if(conversation.status==='attention'&&!obsolete.size)continue;
   let body:string;
   if(!actions.length){
    if(messages.some(message=>message.direction==='inbound'&&alibabaBindingRequest.test(decryptSecret(message.body_ciphertext,encryptionKey,'alibaba-message:'+message.id).toString('utf8')))){
     await db.query("UPDATE alibaba_conversations SET status='attention',reason='BINDING_REQUEST_REQUIRES_REVIEW' WHERE id=$1",[conversation.id]);
     await refreshAlibabaStage(db,conversation.candidate_id);continue;
    }
    const s=gate.source;
    body=`Hello, we are researching ${s.keyword_display}. Product reference: ${conversation.product_url}\n${specification(s)}\nPlease quote 100, 300, and 500 sale units separately in USD, define what one sale unit contains, and state the MOQ. These quantities are comparison scenarios only. Please list unit price, packaging cost, production lead time, carton dimensions/weight, and freight and duties separately. Please state whether a DDP quote to the USA (final ZIP/address TBD; please state destination assumptions for any provisional freight estimate) is available and what is included/excluded. Please quote any sample cost only; do not send a sample.\n${alibabaNonbinding}`;
   }else{
    const latestSent=messages.filter(message=>actions.some(action=>action.state==='sent'&&action.sent_message_id===message.id)).sort((a,b)=>b.sent_at.getTime()-a.sent_at.getTime())[0];
    if(!latestSent)continue;
    const replies=messages.filter(message=>message.direction==='inbound'&&message.sent_at>latestSent.sent_at);
    const inbound=replies[0];
    if(!inbound||actions.some(action=>action.inbound_message_id===inbound?.id))continue;
    const text=replies.map(message=>decryptSecret(message.body_ciphertext,encryptionKey,'alibaba-message:'+message.id).toString('utf8')).join('\n');
    let reason:string|null=alibabaBindingRequest.test(text)?'BINDING_REQUEST_REQUIRES_REVIEW':null;
    if(counted.filter(action=>action.kind==='followup').length>=3)reason='NEGOTIATION_LIMIT_REACHED';
    if(reason){await db.query("UPDATE alibaba_conversations SET status='attention',reason=$2 WHERE id=$1",[conversation.id,reason]);await refreshAlibabaStage(db,conversation.candidate_id);continue;}
    if(conversation.status==='attention'){
     if(messages.find(message=>message.direction==='outbound')?.id!==latestSent.id)continue;
     await db.query("UPDATE alibaba_conversations SET status='awaiting_reply',reason=NULL,next_check_at=clock_timestamp() WHERE id=$1",[conversation.id]);
     await refreshAlibabaStage(db,conversation.candidate_id);
    }
    continue;
   }
   const id=randomUUID();
   body+='\nInquiry reference: FK-'+id;
   if(body.length>4000){await db.query("UPDATE alibaba_conversations SET status='attention',reason='INQUIRY_TOO_LONG' WHERE id=$1",[conversation.id]);await refreshAlibabaStage(db,conversation.candidate_id);continue;}
   await db.query(`INSERT INTO alibaba_actions(id,conversation_id,candidate_id,spec_id,input_version,settings_version,kind,inbound_message_id,body_ciphertext,body_sha256)
    VALUES($1,$2,$3,$4,$5,$6,'initial',NULL,$7,$8)`,[id,conversation.id,conversation.candidate_id,conversation.spec_id,conversation.input_version,conversation.settings_version,encryptSecret(Buffer.from(body),encryptionKey,'alibaba-action:'+id),hash(body)]);
   await db.query("UPDATE alibaba_conversations SET status='queued',reason=NULL WHERE id=$1",[conversation.id]);
   await refreshAlibabaStage(db,conversation.candidate_id);created++;
  }
  await db.query('COMMIT');return created;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

export async function queueAlibabaTask(pool:Pool,target:TaskTarget,signing:Signing) {
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const device=await lockActiveBridgeDevice(db,target.deviceId);
  const conversation=(await db.query<AlibabaConversationRow>('SELECT c.* FROM alibaba_conversations c WHERE id=$1 AND NOT alibaba_conversation_retired(c) FOR UPDATE',[target.conversationId])).rows[0];
  const kind=target.actionId?'supplier_send':'supplier_thread';
  if(!device||!conversation){await db.query('COMMIT');return {kind:'not_ready' as const};}
  const ready=await db.query("SELECT 1 FROM bridge_devices WHERE id=$1 AND reported_connected AND reported_at>clock_timestamp()-interval '90 seconds' AND reported_key_fingerprint=$2 AND $3=ANY(reported_tasks)",[device.id,signing.fingerprint,kind]);
  if(!ready.rowCount){await db.query('COMMIT');return {kind:'not_ready' as const};}
  let action:AlibabaActionRow|undefined;
  let recovering=false;
  let basedOnInbound:AlibabaMessageAnchor|undefined,negotiation:AlibabaNegotiationContext|undefined;
  const aiAdmission=target.aiRecovery?await aiIncidentEvidence(db,target,conversation,signing):null;
  if(target.aiRecovery&&!aiAdmission){await db.query('ROLLBACK');return {kind:'not_ready' as const};}
  if(aiAdmission){negotiation=aiAdmission.negotiation;}
  else if(target.actionId){
   action=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE id=$1 AND conversation_id=$2 FOR UPDATE',[target.actionId,conversation.id])).rows[0];
   const gate=await lockAlibabaContext(db,conversation.candidate_id);
   if(!action||!conversation.account_id||!conversation.provider_thread_id||!gate.ready||gate.source.spec_id!==action.spec_id||gate.source.input_version!==action.input_version||gate.source.settings_version!==action.settings_version){await db.query('COMMIT');return {kind:'not_ready' as const};}
   if(target.recovery)recovering=await recoveryEvidence(db,target,conversation,action,signing);
   if((target.recovery&&!recovering)||(!recovering&&(action.state!=='pending'||['attention','paused'].includes(conversation.status)))){await db.query('COMMIT');return {kind:'not_ready' as const};}
   if(action.kind==='followup'){
    const inbound=(await db.query<AlibabaMessageRow>("SELECT * FROM alibaba_messages WHERE id=$1 AND conversation_id=$2 AND direction='inbound'",[action.inbound_message_id,conversation.id])).rows[0];
    if(!inbound){await db.query('COMMIT');return {kind:'not_ready' as const};}
    basedOnInbound=anchor(inbound);
   }
  }else if(!target.recoveryRead&&conversation.account_id&&conversation.provider_thread_id&&['awaiting_reply','negotiating'].includes(conversation.status)){
   const gate=await lockAlibabaContext(db,conversation.candidate_id);
   const actions=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE conversation_id=$1',[conversation.id])).rows;
   const messages=(await db.query<AlibabaMessageRow>('SELECT * FROM alibaba_messages WHERE conversation_id=$1 ORDER BY sent_at DESC,provider_message_id DESC',[conversation.id])).rows;
   const obsolete=await alibabaStaleDraftIds(db,conversation,actions,messages,target.encryptionKey),counted=actions.filter(a=>!obsolete.has(a.id));
   const round=counted.filter(row=>row.kind==='followup').length+1;
   if(gate.ready&&gate.source.spec_id===conversation.spec_id&&gate.source.input_version===conversation.input_version&&gate.source.settings_version===conversation.settings_version&&counted.length&&counted.every(row=>row.state==='sent')&&round<=3){
    const latest=(await db.query<AlibabaMessageRow>("SELECT * FROM alibaba_messages WHERE conversation_id=$1 AND direction='outbound' ORDER BY sent_at DESC,provider_message_id DESC LIMIT 1",[conversation.id])).rows[0];
    if(latest&&actions.some(row=>row.sent_message_id===latest.id)){
     const context=alibabaNegotiationContextSchema.safeParse({keyword:gate.source.keyword_display,specification:specification(gate.source),lastOutbound:anchor(latest),round});
     if(context.success)negotiation=context.data;
     else{await db.query("UPDATE alibaba_conversations SET status='attention',reason='NEGOTIATION_CONTEXT_TOO_LARGE',next_check_at=NULL WHERE id=$1",[conversation.id]);await refreshAlibabaStage(db,conversation.candidate_id);}
    }
   }
  }
  await db.query("UPDATE browser_tasks t SET state='cancelled' WHERE conversation_id=$1 AND state IN ('queued','delivered') AND expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.dispatch_task_id=t.id AND a.started_at IS NOT NULL)",[conversation.id]);
  const prior=await db.query(`SELECT t.id FROM browser_tasks t WHERE t.conversation_id=$1 AND t.task_kind=$2 AND t.action_id IS NOT DISTINCT FROM $3::uuid
   AND (t.state IN ('queued','delivered') OR ($3::uuid IS NOT NULL AND t.state='completed' AND NOT $4 AND NOT EXISTS(
    SELECT 1 FROM audit_events e JOIN alibaba_actions a ON a.id=t.action_id
    WHERE e.action='alibaba_started_presend_recovery' AND e.target=a.id::text AND e.meta->>'disposition'='requeue' AND e.meta->>'originalTaskId'=t.id::text
     AND a.kind='initial' AND a.state='pending' AND a.started_at IS NULL AND a.dispatch_task_id IS NULL AND a.sent_message_id IS NULL)))`,[conversation.id,kind,action?.id??null,recovering]);
  if(prior.rowCount){await db.query('COMMIT');return {kind:'existing' as const};}
  const common={accountId:conversation.account_id,candidateId:conversation.candidate_id,specId:conversation.spec_id,inputVersion:conversation.input_version,settingsVersion:conversation.settings_version,conversationId:conversation.id,companyName:conversation.company_name,companyUrl:conversation.company_url,productUrl:conversation.product_url,threadId:conversation.provider_thread_id};
  const request:BrowserReadTask['request']=action&&conversation.account_id!==null&&conversation.provider_thread_id!==null?{kind:'supplier_send',...common,accountId:conversation.account_id,threadId:conversation.provider_thread_id,actionId:action.id,body:decryptSecret(action.body_ciphertext,target.encryptionKey,'alibaba-action:'+action.id).toString('utf8'),...(basedOnInbound?{basedOnInbound}:{})}:{kind:'supplier_thread',...common,...(negotiation?{negotiation}:{})};
  const now=new Date(),expiresAt=new Date(now.getTime()+300000).toISOString(),id=randomUUID();
  const unsigned:BrowserReadTask={version:1,id,issuerOrigin:signing.origin,deviceId:device.id,issuedAt:now.toISOString(),expiresAt,request};
  if(Buffer.byteLength(JSON.stringify(unsigned),'utf8')>MAX_BROWSER_TASK_BYTES){
   if(recovering||aiAdmission){await db.query('ROLLBACK');return {kind:'not_ready' as const};}
   if(action)await db.query("UPDATE alibaba_actions SET state='blocked',reason='INQUIRY_TOO_LONG' WHERE id=$1 AND state='pending'",[action.id]);
   await db.query("UPDATE alibaba_conversations SET status='attention',reason='INQUIRY_TOO_LONG' WHERE id=$1",[conversation.id]);
   await refreshAlibabaStage(db,conversation.candidate_id);
   await db.query('COMMIT');return {kind:'not_ready' as const};
  }
  const envelope=signBrowserTask(unsigned,signing.privateKey);
  if(recovering&&action){
   await db.query("UPDATE alibaba_actions SET state='pending',reason=NULL WHERE id=$1",[action.id]);
   await db.query("UPDATE alibaba_conversations SET status='negotiating',reason=NULL WHERE id=$1",[conversation.id]);
   await refreshAlibabaStage(db,conversation.candidate_id);
   await db.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:operator','alibaba_unstarted_recovery',$1,$2::jsonb)",[action.id,JSON.stringify({...target.recovery,deviceId:device.id,newTaskId:id})]);
  }
  await db.query(`INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,action_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,device.id,conversation.candidate_id,conversation.spec_id,conversation.input_version,conversation.settings_version,JSON.stringify(envelope),hash(envelope.payload),expiresAt,kind,conversation.id,action?.id??null]);
  if(aiAdmission){
   await db.query("UPDATE alibaba_conversations SET status='awaiting_reply',reason=NULL,next_check_at=clock_timestamp()+interval '15 minutes' WHERE id=$1",[conversation.id]);
   await refreshAlibabaStage(db,conversation.candidate_id);
   await db.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:operator','alibaba_ai_incident_admission',$1,$2::jsonb)",[conversation.id,JSON.stringify({...aiAdmission.meta,newTaskId:id,newTaskHash:hash(envelope.payload)})]);
  }
  await db.query('COMMIT');return {kind:'queued' as const,taskId:id};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function recoverAlibabaStartedPresend(pool:Pool,target:{deviceId:string;conversationId:string;actionId:string;readReceiptId:string;authorizationReference:string;encryptionKey:Buffer},signing:Signing) {
 const db=await pool.connect(),refused={kind:'not_ready' as const};
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const parent=(await db.query<{candidate_id:string}>('SELECT candidate_id FROM alibaba_conversations WHERE id=$1',[target.conversationId])).rows[0];
  if(!parent){await db.query('ROLLBACK');return refused;}
  const gate=await lockAlibabaContext(db,parent.candidate_id),device=await lockActiveBridgeDevice(db,target.deviceId);
  const c=(await db.query<AlibabaConversationRow>('SELECT * FROM alibaba_conversations WHERE id=$1 FOR UPDATE',[target.conversationId])).rows[0];
  const a=(await db.query<AlibabaActionRow&{original_started_at:string}>('SELECT a.*,to_char(started_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS original_started_at FROM alibaba_actions a WHERE id=$1 AND conversation_id=$2 FOR UPDATE',[target.actionId,target.conversationId])).rows[0];
  if(!gate.ready||!device||!c||!a||gate.source.spec_id!==c.spec_id||gate.source.input_version!==c.input_version||gate.source.settings_version!==c.settings_version||a.spec_id!==c.spec_id||a.input_version!==c.input_version||a.settings_version!==c.settings_version||!c.account_id||!c.provider_thread_id||!target.authorizationReference.trim()||target.authorizationReference.length>240){await db.query('ROLLBACK');return refused;}
  const ready=await db.query("SELECT 1 FROM bridge_devices WHERE id=$1 AND reported_connected AND reported_at>clock_timestamp()-interval '90 seconds' AND reported_key_fingerprint=$2 AND 'supplier_send'=ANY(reported_tasks) AND 'supplier_thread'=ANY(reported_tasks)",[device.id,signing.fingerprint]);
  if(!ready.rowCount){await db.query('ROLLBACK');return refused;}
  type Recorded={disposition:'requeue'|'reconciled';newTaskId:string|null;messageId:string|null};
  const prior=(await db.query<{meta:Recorded}>("SELECT meta FROM audit_events WHERE action='alibaba_started_presend_recovery' AND target=$1",[a.id])).rows[0];
  if(prior){await db.query('COMMIT');return {kind:'recovered' as const,disposition:prior.meta.disposition,actionId:a.id,taskId:prior.meta.newTaskId,messageId:prior.meta.messageId,repeated:true};}
  if(a.kind!=='initial'||a.state!=='blocked'||a.reason!=='SEND_NOT_CONFIRMED'||!a.started_at||!a.dispatch_task_id||a.sent_message_id||c.status!=='attention'||c.reason!=='SEND_NOT_CONFIRMED'){await db.query('ROLLBACK');return refused;}
  const old=(await db.query<{result_id:string}>('SELECT result_id FROM browser_tasks WHERE id=$1',[a.dispatch_task_id])).rows[0];
  if(!old||(await db.query<{allowed:boolean}>('SELECT alibaba_presend_incident($1,$2,$3,$4,$5::timestamptz) AS allowed',[a.id,c.id,a.dispatch_task_id,old.result_id,a.original_started_at])).rows[0]?.allowed!==true){await db.query('ROLLBACK');return refused;}
  if((await db.query("SELECT 1 FROM browser_tasks WHERE conversation_id=$1 AND state IN ('queued','delivered') UNION ALL SELECT 1 FROM alibaba_actions WHERE conversation_id=$1 AND id<>$2",[c.id,a.id])).rowCount){await db.query('ROLLBACK');return refused;}
  const receipts=(await db.query<RecoveryReceipt&{expires_at:Date}>(`SELECT r.*,t.id AS task_id,t.task_kind,t.action_id,t.task_hash,t.envelope,t.created_at AS task_created_at,t.expires_at
   FROM browser_tasks t JOIN browser_task_results r ON r.id=t.result_id AND r.task_id=t.id
   WHERE r.id=ANY($1::uuid[]) AND t.state='completed' AND t.device_id=$2 AND t.conversation_id=$3
    AND t.candidate_id=$4 AND t.spec_id IS NOT DISTINCT FROM $5::uuid AND t.input_version=$6 AND t.settings_version=$7`,[[old.result_id,target.readReceiptId],device.id,c.id,c.candidate_id,c.spec_id,c.input_version,c.settings_version])).rows;
  const failed=receipts.find(r=>r.id===old.result_id),read=receipts.find(r=>r.id===target.readReceiptId);
  if(!failed||!read||failed.id===read.id||failed.task_id!==a.dispatch_task_id||failed.task_kind!=='supplier_send'||failed.action_id!==a.id||read.task_kind!=='supplier_thread'||read.action_id!==null||read.task_created_at<=failed.created_at||read.created_at<=failed.created_at){await db.query('ROLLBACK');return refused;}
  const messages=(await db.query<AlibabaMessageRow&{timely:boolean}>('SELECT m.*,m.sent_at>=a.started_at-interval \'5 seconds\' AS timely FROM alibaba_messages m JOIN alibaba_actions a ON a.id=$2 WHERE m.conversation_id=$1',[c.id,a.id])).rows;
  let body:string,observedAt:string,matched:AlibabaMessageRow|undefined;
  try{
   body=decryptSecret(a.body_ciphertext,target.encryptionKey,'alibaba-action:'+a.id).toString('utf8');
   if(hash(body)!==a.body_sha256)throw new Error('body');
   for(const receipt of [failed,read]){
    const task=browserTaskSchema.parse(JSON.parse(Buffer.from(receipt.envelope.payload,'base64url').toString('utf8'))),request=task.request;
    const o=browserObservationSchema.parse(JSON.parse(decryptSecret(receipt.body_ciphertext,target.encryptionKey,'browser-task-result:'+receipt.id).toString('utf8')));
    if(hash(receipt.envelope.payload)!==receipt.task_hash||exactPayloadHash(o)!==receipt.body_sha256||!verify(null,Buffer.from(BROWSER_TASK_SIGNATURE_PREFIX+receipt.envelope.payload),createPublicKey(signing.privateKey),Buffer.from(receipt.envelope.signature,'base64url'))||task.id!==receipt.task_id||task.deviceId!==device.id||task.issuerOrigin!==signing.origin||Date.parse(task.expiresAt)!==receipt.expires_at.getTime())throw new Error('signed proof');
    if((request.kind!=='supplier_thread'&&request.kind!=='supplier_send')||request.kind!==receipt.task_kind||request.candidateId!==c.candidate_id||request.specId!==c.spec_id||request.inputVersion!==c.input_version||request.settingsVersion!==c.settings_version||request.conversationId!==c.id||request.accountId!==c.account_id||request.threadId!==c.provider_thread_id||request.companyName!==c.company_name||request.companyUrl!==c.company_url||request.productUrl!==c.product_url)throw new Error('scope');
    if(o.kind!=='captured'||o.scope!=='alibaba_thread'||o.conversationId!==c.id||o.accountId!==c.account_id||o.threadId!==c.provider_thread_id||alibabaCompanyKey(o.companyUrl)!==c.company_key||alibabaProductKey(o.productUrl)!==alibabaProductKey(c.product_url))throw new Error('recipient');
    const observed=Date.parse(o.observedAt);
    if(observed<Date.parse(task.issuedAt)||observed>Date.parse(task.expiresAt)||observed>Date.now()||o.messages.some(m=>Date.parse(m.sentAt)>observed))throw new Error('observation time');
    if(request.kind==='supplier_send'){
     if(request.actionId!==a.id||request.body!==body||request.basedOnInbound||o.actionId!==a.id||o.sendStatus!=='not_sent'||o.reason!=='ALIBABA_SEND_UNAVAILABLE'||o.messages.length)throw new Error('original pre-click refusal');
    }else{
     if(request.negotiation||o.proposal||o.actionId!==null||o.sendStatus!=='read'||o.reason!==null||Date.parse(task.issuedAt)<=failed.created_at.getTime()||observed<=failed.created_at.getTime())throw new Error('fresh read');
     observedAt=o.observedAt;
     if(o.messages.some(m=>!messages.some(saved=>saved.provider_message_id===m.id&&saved.direction===m.direction&&saved.sent_at.getTime()===Date.parse(m.sentAt)&&saved.body_sha256===hash(m.body))))throw new Error('message identity');
     if(messages.some(m=>!o.messages.some(seen=>seen.id===m.provider_message_id)))throw new Error('incomplete current evidence');
     const outbound=messages.filter(m=>m.direction==='outbound');
     if(outbound.length>1||outbound.some(m=>m.body_sha256!==a.body_sha256||!m.timely))throw new Error('manual outbound');
     if(messages.some(m=>m.direction==='inbound'&&alibabaBindingRequest.test(decryptSecret(m.body_ciphertext,target.encryptionKey,'alibaba-message:'+m.id).toString('utf8'))))throw new Error('binding request');
     matched=outbound[0];
    }
   }
  }catch{await db.query('ROLLBACK');return refused;}
  const fresh=await db.query('SELECT 1 FROM browser_task_results WHERE id=$1 AND created_at BETWEEN clock_timestamp()-interval \'5 minutes\' AND clock_timestamp() AND $2::timestamptz BETWEEN clock_timestamp()-interval \'5 minutes\' AND clock_timestamp()',[read.id,observedAt!]);
  if(!fresh.rowCount){await db.query('ROLLBACK');return refused;}
  const disposition=matched?'reconciled' as const:'requeue' as const,id=matched?null:randomUUID();
  const now=new Date(),expiresAt=new Date(now.getTime()+300000).toISOString();
  const unsigned:BrowserReadTask={version:1,id:id??randomUUID(),issuerOrigin:signing.origin,deviceId:device.id,issuedAt:now.toISOString(),expiresAt,request:{kind:'supplier_send',candidateId:c.candidate_id,specId:c.spec_id,inputVersion:c.input_version,settingsVersion:c.settings_version,conversationId:c.id,companyName:c.company_name,companyUrl:c.company_url,productUrl:c.product_url,accountId:c.account_id,threadId:c.provider_thread_id,actionId:a.id,body:body!}};
  if(Buffer.byteLength(JSON.stringify(unsigned),'utf8')>MAX_BROWSER_TASK_BYTES){await db.query('ROLLBACK');return refused;}
  const envelope=id?signBrowserTask(unsigned,signing.privateKey):null;
  const meta={incident:'alibaba-presend-20260928',authorizationReference:target.authorizationReference,conversationId:c.id,originalStartedAt:a.original_started_at,originalTaskId:failed.task_id,originalReceiptId:failed.id,readReceiptId:read.id,readObservedAt:observedAt!,disposition,newTaskId:id,messageId:matched?.id??null,bodyHash:a.body_sha256,originalTaskHash:failed.task_hash,originalReceiptHash:failed.body_sha256,readTaskHash:read.task_hash,readReceiptHash:read.body_sha256,originalClientHash:'c0b74ca596aa7a347ceb00ecf4956d30e8105952f29d7751a6a6c64b9b21f9d9',originalArchiveHash:'6f5a3ed8f863a657f4784d9a8a6c0ee1b29b260416327a3d5acbdd0ebd758954'};
  await db.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:operator','alibaba_started_presend_recovery',$1,$2::jsonb)",[a.id,JSON.stringify({...meta,newTaskHash:envelope?hash(envelope.payload):null})]);
  if(id&&envelope){
   await db.query("UPDATE alibaba_actions SET state='pending',reason=NULL,started_at=NULL,dispatch_task_id=NULL WHERE id=$1",[a.id]);
   await db.query(`INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,action_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'supplier_send',$10,$11)`,[id,device.id,c.candidate_id,c.spec_id,c.input_version,c.settings_version,JSON.stringify(envelope),hash(envelope.payload),expiresAt,c.id,a.id]);
  }else await db.query("UPDATE alibaba_actions SET state='sent',reason=NULL,sent_message_id=$2 WHERE id=$1",[a.id,matched!.id]);
  await db.query('UPDATE alibaba_conversations SET status=$2,reason=NULL,next_check_at=clock_timestamp()+interval \'15 minutes\' WHERE id=$1',[c.id,id?'queued':'awaiting_reply']);
  await refreshAlibabaStage(db,c.candidate_id);
  await db.query('COMMIT');return {kind:'recovered' as const,disposition,actionId:a.id,taskId:id,messageId:matched?.id??null,repeated:false};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

export async function dispatchAlibabaWork(pool:Pool,signing:Signing,encryptionKey:Buffer):Promise<number> {
 await recoverAlibabaSources(pool,encryptionKey);
 await prepareAlibabaActions(pool,encryptionKey);
 const devices=(await pool.query<{id:string;kind:'supplier_thread'|'supplier_send'}>(`SELECT DISTINCT ON(kind) id,kind FROM bridge_devices
  CROSS JOIN LATERAL unnest(reported_tasks) kind WHERE revoked_at IS NULL AND reported_connected AND reported_at>clock_timestamp()-interval '90 seconds'
  AND reported_key_fingerprint=$1 AND kind IN ('supplier_thread','supplier_send') ORDER BY kind,reported_at DESC`,[signing.fingerprint])).rows;
 let queued=0;
 for(const device of devices){
  const outstanding=(await pool.query<{count:number}>("SELECT count(*)::int AS count FROM browser_tasks WHERE task_kind=$1 AND state='queued' AND expires_at>clock_timestamp()",[device.kind])).rows[0]?.count??0;
  const room=Math.max(0,2-outstanding);
  if(!room)continue;
  const work=device.kind==='supplier_send'?(await pool.query<{conversation_id:string;action_id:string}>(`SELECT a.conversation_id,a.id AS action_id FROM alibaba_actions a
   WHERE a.state='pending' AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.action_id=a.id AND t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp()) ORDER BY a.created_at`)).rows
   :(await pool.query<{conversation_id:string;action_id:null}>(`SELECT c.id AS conversation_id,NULL AS action_id FROM alibaba_conversations c
    WHERE (c.next_check_at IS NULL OR c.next_check_at<=clock_timestamp())
     AND (c.status IN ('queued','awaiting_reply','negotiating')
      OR (c.status='attention' AND (c.reason='NEGOTIATION_LIMIT_REACHED' OR (c.reason='SEND_NOT_CONFIRMED'
       AND EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.conversation_id=c.id AND a.kind='initial' AND a.state='blocked' AND a.reason='SEND_NOT_CONFIRMED' AND a.started_at IS NOT NULL))))
      OR EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.conversation_id=c.id AND a.state IN ('dispatching','outcome_unknown')))
     AND (c.provider_thread_id IS NOT NULL OR c.status='queued')
     AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.conversation_id=c.id AND t.task_kind='supplier_thread' AND t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())
    ORDER BY COALESCE((SELECT COALESCE(max(prior.delivered_at),min(prior.created_at)) FROM browser_tasks prior
     WHERE prior.conversation_id=c.id AND prior.task_kind='supplier_thread'),c.created_at),c.created_at,c.id LIMIT $1`,[room])).rows;
  // Sends are not limited in SQL: queueAlibabaTask refuses some pending actions (paused/attention conversations), and those must not hold the room.
  let placed=0;
  for(const row of work){
   if(placed>=room)break;
   if((await queueAlibabaTask(pool,{deviceId:device.id,conversationId:row.conversation_id,...(row.action_id?{actionId:row.action_id}:{}),encryptionKey},signing)).kind==='queued'){queued++;placed++;}
  }
 }
 return queued;
}

async function recoverAlibabaSources(pool:Pool,encryptionKey:Buffer) {
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const sources=(await db.query<{candidate_id:string;receipt_id:string;body_ciphertext:string}>(`SELECT t.candidate_id,r.id AS receipt_id,r.body_ciphertext
   FROM browser_tasks t JOIN browser_task_results r ON r.task_id=t.id AND r.id=t.result_id JOIN candidates c ON c.id=t.candidate_id
   JOIN LATERAL(SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
   WHERE t.task_kind='supplier_search' AND t.state='completed' AND t.input_version=c.input_version AND t.settings_version=v.version
    AND v.snapshot->>'supplierContactMode'='website' AND t.spec_id IS NOT DISTINCT FROM (SELECT id FROM spec_revisions WHERE candidate_id=c.id ORDER BY revision DESC LIMIT 1)
    AND (NOT EXISTS(SELECT 1 FROM alibaba_conversations ac WHERE ac.candidate_id=c.id)
     OR EXISTS(SELECT 1 FROM alibaba_conversations ac WHERE ac.candidate_id=c.id AND ac.source_receipt_id=r.id
      AND ac.spec_id IS NOT DISTINCT FROM t.spec_id AND ac.input_version=t.input_version AND ac.settings_version=t.settings_version
      AND ((alibaba_conversation_retired(ac) AND (SELECT count(*) FROM alibaba_conversations active WHERE active.candidate_id=c.id AND NOT alibaba_conversation_retired(active))<3)
       OR (((ac.status='attention' AND ac.reason='THREAD_OWNERSHIP_CONFLICT')
        OR (ac.status='queued' AND ac.reason IS NULL AND EXISTS(SELECT 1 FROM alibaba_conversations owner
         WHERE owner.candidate_id<>ac.candidate_id AND owner.company_key=ac.company_key AND owner.account_id IS NOT NULL AND owner.provider_thread_id IS NOT NULL)))
       AND ac.account_id IS NULL AND ac.provider_thread_id IS NULL
       AND NOT EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.conversation_id=ac.id)
       AND NOT EXISTS(SELECT 1 FROM alibaba_messages m WHERE m.conversation_id=ac.id)))))
   ORDER BY t.created_at,t.id`)).rows;
  for(const source of sources){
   const gate=await lockAlibabaContext(db,source.candidate_id);
   if(!gate.ready)continue;
   const observation=browserObservationSchema.parse(JSON.parse(decryptSecret(source.body_ciphertext,encryptionKey,'browser-task-result:'+source.receipt_id).toString('utf8')));
   if(observation.scope!=='first_results_page'||observation.query!==gate.source.keyword_display)continue;
   const companies=observation.records.flatMap(record=>{
    const key=alibabaCompanyKey(record.companyUrl);
    return key&&alibabaProductKey(record.productUrl)?[{key,name:record.companyName,companyUrl:record.companyUrl,productUrl:record.productUrl}]:[];
   });
   await db.query(`WITH duplicates AS (SELECT c.id FROM alibaba_conversations c
    WHERE c.candidate_id=$1 AND c.source_receipt_id=$2 AND c.spec_id IS NOT DISTINCT FROM $3::uuid AND c.input_version=$4 AND c.settings_version=$5
     AND c.status='queued' AND c.reason IS NULL AND c.account_id IS NULL AND c.provider_thread_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.conversation_id=c.id)
     AND NOT EXISTS(SELECT 1 FROM alibaba_messages m WHERE m.conversation_id=c.id)
     AND EXISTS(SELECT 1 FROM alibaba_conversations owner WHERE owner.candidate_id<>c.candidate_id AND owner.company_key=c.company_key
      AND owner.account_id IS NOT NULL AND owner.provider_thread_id IS NOT NULL) FOR UPDATE OF c)
    UPDATE alibaba_conversations SET status='attention',reason='THREAD_OWNERSHIP_CONFLICT' WHERE id IN(SELECT id FROM duplicates)`,
    [gate.source.id,source.receipt_id,gate.source.spec_id,gate.source.input_version,gate.source.settings_version]);
   const retired=await db.query(`UPDATE alibaba_conversations c SET status='paused'
    WHERE candidate_id=$1 AND source_receipt_id=$2 AND spec_id IS NOT DISTINCT FROM $3::uuid AND input_version=$4 AND settings_version=$5
     AND status='attention' AND reason='THREAD_OWNERSHIP_CONFLICT' AND account_id IS NULL AND provider_thread_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.conversation_id=c.id)
     AND NOT EXISTS(SELECT 1 FROM alibaba_messages m WHERE m.conversation_id=c.id)`,[gate.source.id,source.receipt_id,gate.source.spec_id,gate.source.input_version,gate.source.settings_version]);
   const added=await registerAlibabaCompanies(db,{source:gate.source,receiptId:source.receipt_id,companies});
   if(retired.rowCount&&!added)await refreshAlibabaStage(db,gate.source.id);
  }
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
