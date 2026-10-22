import {createHash,randomUUID} from 'node:crypto';
import {lockAlibabaContext,registerAlibabaCompanies,refreshAlibabaStage,type QueryConnection,type AlibabaConversationRow,type AlibabaMessageRow,type AlibabaActionRow} from '@forge-ops/db';
import {alibabaBindingRequest,alibabaNonbinding,alibabaReplyIsSafe,type AlibabaObservation,type BrowserObservation,type BrowserReadTask} from '@forge-ops/domain';
import {decryptSecret,encryptSecret} from '@forge-ops/security';
import {alibabaCompanyKey,alibabaProductKey,alibabaStaleDraftIds} from '@forge-ops/integrations/sourcing/capture';
import {readAlibabaTaskBinding} from './alibaba-dispatch.ts';
import type {CandidateBrowserTaskRow} from './browser-task-store.ts';

export async function recordAlibabaSearch(db:QueryConnection,input:{task:CandidateBrowserTaskRow;observation:Extract<BrowserObservation,{scope:'first_results_page'}>;receiptId:string}) {
 const gate=await lockAlibabaContext(db,input.task.candidate_id);
 if(!gate.ready)return;
 const companies=input.observation.records.flatMap(record=>{
  const key=alibabaCompanyKey(record.companyUrl);
  return key&&alibabaProductKey(record.productUrl)?[{key,name:record.companyName,companyUrl:record.companyUrl,productUrl:record.productUrl}]:[];
 });
 await registerAlibabaCompanies(db,{source:gate.source,receiptId:input.receiptId,companies});
}
export async function recordAlibabaTaskResult(db:QueryConnection,input:{task:CandidateBrowserTaskRow;observation:BrowserObservation;bodyHash:string;encryptionKey:Buffer}) {
 const {task,observation,encryptionKey}=input;
 const binding=await readAlibabaTaskBinding(db,task);
 if(!binding||observation.scope!=='alibaba_thread')return {kind:'invalid' as const};
 const {conversation,action,payload,request}=binding;
 const late=action?.dispatch_task_id===task.id&&action.started_at!==null;
 const preflightRefusal=request.kind==='supplier_send'&&action?.started_at===null&&action.dispatch_task_id===null&&observation.sendStatus==='not_sent'&&(action.state==='pending'||(action.state==='blocked'&&action.reason==='NEGOTIATION_CONTEXT_CHANGED'));
 const now=Date.now(),observed=Date.parse(observation.observedAt);
 if(task.state!=='delivered'||(!late&&task.expires_at.getTime()<=now)||observed>now||observed<Date.parse(payload.issuedAt)||(!late&&observed>Date.parse(payload.expiresAt)))return {kind:'stale' as const};
 if(observation.conversationId!==conversation.id||alibabaCompanyKey(observation.companyUrl)!==conversation.company_key||alibabaProductKey(observation.productUrl)!==alibabaProductKey(conversation.product_url)||observation.actionId!==(action?.id??null)||(request.kind==='supplier_send'&&!late&&!preflightRefusal))return {kind:'invalid' as const};
 if(observation.messages.some(message=>Date.parse(message.sentAt)>observed))return {kind:'invalid' as const};
 const receiptId=randomUUID();
 const ciphertext=encryptSecret(Buffer.from(JSON.stringify(observation)),encryptionKey,'browser-task-result:'+receiptId);
 await db.query('INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids) VALUES($1,$2,$3,$4,$5)',[receiptId,task.id,input.bodyHash,ciphertext,[]]);
 // Global thread ownership is serialized by forge.settings, not inferred from a supplier name.
 const owner=(await db.query<AlibabaConversationRow>('SELECT * FROM alibaba_conversations WHERE account_id=$1 AND provider_thread_id=$2',[observation.accountId,observation.threadId])).rows[0];
 const conflict=Boolean(owner&&owner.id!==conversation.id)||Boolean(conversation.provider_thread_id&&(conversation.provider_thread_id!==observation.threadId||conversation.account_id!==observation.accountId));
 if(conflict){
  await db.query("UPDATE alibaba_conversations SET status='attention',reason='THREAD_OWNERSHIP_CONFLICT',next_check_at=NULL WHERE id=$1",[conversation.id]);
  await db.query("UPDATE alibaba_actions SET state=CASE WHEN state='pending' THEN 'blocked' ELSE 'outcome_unknown' END,reason='THREAD_OWNERSHIP_CONFLICT' WHERE conversation_id=$1 AND state IN ('pending','dispatching')",[conversation.id]);
 }else{
  await storeThread(db,{conversation,observation,receiptId,encryptionKey,action});
  if(preflightRefusal&&action){
   const reason=observation.reason==='NEGOTIATION_CONTEXT_CHANGED'?'NEGOTIATION_CONTEXT_CHANGED':'SEND_NOT_CONFIRMED';
   await db.query("UPDATE alibaba_actions SET state='blocked',reason=$2 WHERE id=$1 AND state='pending'",[action.id,reason]);
   await db.query("UPDATE alibaba_conversations SET status='attention',reason=COALESCE(reason,$2),next_check_at=NULL WHERE id=$1",[conversation.id,reason]);
  }
  if(request.kind==='supplier_thread'&&request.negotiation&&observation.proposal)await storeNegotiation(db,{request,observation,encryptionKey});
 }
 await db.query("UPDATE browser_tasks SET state='completed',result_id=$2 WHERE id=$1",[task.id,receiptId]);
 await refreshAlibabaStage(db,conversation.candidate_id);
 await db.query("INSERT INTO audit_events(actor,action,target) SELECT owner_user_id,'alibaba_observation_recorded',$2 FROM bridge_devices WHERE id=$1",[task.device_id,receiptId]);
 return {kind:'accepted' as const,receiptId,resultHash:input.bodyHash,captureIds:[] as string[]};
}
async function storeNegotiation(db:QueryConnection,input:{readonly request:Extract<BrowserReadTask['request'],{kind:'supplier_thread'}>;readonly observation:AlibabaObservation;readonly encryptionKey:Buffer}) {
 const {request,observation,encryptionKey}=input,context=request.negotiation,proposal=observation.proposal;
 if(!context||!proposal)return;
 const conversation=(await db.query<AlibabaConversationRow>('SELECT * FROM alibaba_conversations WHERE id=$1',[request.conversationId])).rows[0];
 if(!conversation||!['awaiting_reply','negotiating'].includes(conversation.status))return;
 const gate=await lockAlibabaContext(db,conversation.candidate_id);
 if(!gate.ready||gate.source.spec_id!==conversation.spec_id||gate.source.input_version!==conversation.input_version||gate.source.settings_version!==conversation.settings_version)return;
 const actions=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE conversation_id=$1',[conversation.id])).rows;
 const messages=(await db.query<AlibabaMessageRow>('SELECT * FROM alibaba_messages WHERE conversation_id=$1 ORDER BY sent_at DESC,provider_message_id DESC',[conversation.id])).rows;
 const obsolete=await alibabaStaleDraftIds(db,conversation,actions,messages,encryptionKey),counted=actions.filter(a=>!obsolete.has(a.id));
 if(!counted.length||counted.some(action=>action.state!=='sent'))return;
 const latestOutbound=messages.find(message=>message.direction==='outbound'),outbound=messages.find(message=>message.direction==='outbound'&&actions.some(action=>action.sent_message_id===message.id)),inbound=messages.find(message=>message.direction==='inbound');
 if(!outbound||!inbound||inbound.sent_at<=outbound.sent_at)return;
 if(context.lastOutbound.providerMessageId!==outbound.provider_message_id||Date.parse(context.lastOutbound.sentAt)!==outbound.sent_at.getTime()||context.lastOutbound.bodySha256!==outbound.body_sha256)return;
 if(proposal.basedOnInbound.providerMessageId!==inbound.provider_message_id||Date.parse(proposal.basedOnInbound.sentAt)!==inbound.sent_at.getTime()||proposal.basedOnInbound.bodySha256!==inbound.body_sha256||actions.some(action=>action.inbound_message_id===inbound.id))return;
 if(!observation.messages.some(message=>message.id===inbound.provider_message_id&&message.direction==='inbound'))return;
 const round=counted.filter(action=>action.kind==='followup').length+1;
 const replies=messages.filter(message=>message.direction==='inbound'&&message.sent_at>outbound.sent_at);
 let reason:string|null=replies.some(message=>alibabaBindingRequest.test(decryptSecret(message.body_ciphertext,encryptionKey,'alibaba-message:'+message.id).toString('utf8')))?'BINDING_REQUEST_REQUIRES_REVIEW':null;
 if(round>3)reason='NEGOTIATION_LIMIT_REACHED';
 if(!reason&&context.round!==round)return;
 switch(proposal.decision.kind){
  case 'review':reason??=proposal.decision.reason;break;
  case 'reply':
   if(latestOutbound?.id!==outbound.id||!observation.messages.some(message=>message.id===outbound.provider_message_id&&message.direction==='outbound'))return;
   if(!proposal.execution)reason??='AI_RESPONSE_INVALID';else if(!alibabaReplyIsSafe(proposal.decision.body))reason??='BINDING_REQUEST_REQUIRES_REVIEW';break;
  default:{const exhaustive:never=proposal.decision;return exhaustive;}
 }
 if(reason){
  await db.query(`UPDATE alibaba_conversations SET status='attention',reason=$2,next_check_at=CASE
   WHEN $2 IN ('AI_UNAVAILABLE','AI_RESPONSE_INVALID') AND (SELECT count(*) FROM audit_events
    WHERE action='alibaba_ai_retry' AND target=$1::text AND meta->>'inboundMessageId'=$3)<2
   THEN clock_timestamp()+interval '15 minutes' ELSE NULL END WHERE id=$1::uuid`,[conversation.id,reason,inbound.id]);return;
 }
 if(proposal.decision.kind!=='reply')return;
 const id=randomUUID(),body=proposal.decision.body+'\n'+alibabaNonbinding+'\nInquiry reference: FK-'+id;
 await db.query(`INSERT INTO alibaba_actions(id,conversation_id,candidate_id,spec_id,input_version,settings_version,kind,inbound_message_id,body_ciphertext,body_sha256)
  VALUES($1,$2,$3,$4,$5,$6,'followup',$7,$8,$9)`,[id,conversation.id,conversation.candidate_id,conversation.spec_id,conversation.input_version,conversation.settings_version,inbound.id,encryptSecret(Buffer.from(body),encryptionKey,'alibaba-action:'+id),createHash('sha256').update(body).digest('hex')]);
 await db.query("UPDATE alibaba_conversations SET status='negotiating',reason=NULL WHERE id=$1",[conversation.id]);
}
async function storeThread(db:QueryConnection,input:{conversation:AlibabaConversationRow;observation:AlibabaObservation;receiptId:string;encryptionKey:Buffer;action:AlibabaActionRow|undefined}) {
 const {conversation,observation,receiptId,encryptionKey,action}=input;
 const started=(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE conversation_id=$1 AND started_at IS NOT NULL ORDER BY created_at,id',[conversation.id])).rows;
 let activity:Date|null=null;
 const saved:AlibabaMessageRow[]=[];
 const known=new Map((await db.query<AlibabaMessageRow>('SELECT * FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=ANY($2::text[])',[conversation.id,observation.messages.map(message=>message.id)])).rows.map(row=>[row.provider_message_id,row]));
 for(const message of observation.messages){
  const id=randomUUID(),bodyHash=createHash('sha256').update(message.body).digest('hex');
  const prior=known.get(message.id);
  if(prior){
   if(prior.body_sha256!==bodyHash||prior.direction!==message.direction||prior.sent_at.getTime()!==Date.parse(message.sentAt)){
    await db.query("UPDATE alibaba_conversations SET status='attention',reason='MESSAGE_IDENTITY_CONFLICT' WHERE id=$1",[conversation.id]);return;
   }
   saved.push(prior);continue;
  }
  const row=(await db.query<AlibabaMessageRow>(`INSERT INTO alibaba_messages(id,conversation_id,provider_message_id,direction,body_ciphertext,body_sha256,sent_at,receipt_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,conversation.id,message.id,message.direction,encryptSecret(Buffer.from(message.body),encryptionKey,'alibaba-message:'+id),bodyHash,message.sentAt,receiptId])).rows[0];
  if(row){known.set(row.provider_message_id,row);saved.push(row);if(!activity||row.sent_at>activity)activity=row.sent_at;}
 }
 const historical=started.length===0&&saved.some(message=>message.direction==='outbound');
 await db.query(`UPDATE alibaba_conversations SET account_id=$2,provider_thread_id=$3,thread_url=$4,
  last_activity_at=CASE WHEN $5::timestamptz IS NULL THEN last_activity_at ELSE GREATEST(last_activity_at,$5) END,
  next_check_at=clock_timestamp()+interval '15 minutes',
  status=CASE WHEN $6 THEN 'attention' ELSE status END,reason=CASE WHEN $6 THEN 'EXISTING_THREAD_REQUIRES_REVIEW' ELSE reason END WHERE id=$1`,[conversation.id,observation.accountId,observation.threadId,observation.sourcePageUrl,activity,historical]);
 for(const pending of started.filter(row=>row.state==='dispatching'||row.state==='outcome_unknown')){
  const matched=saved.find(message=>message.direction==='outbound'&&message.body_sha256===pending.body_sha256&&pending.started_at!==null&&message.sent_at.getTime()>=pending.started_at.getTime()-5000);
  if(matched){
   await db.query("UPDATE alibaba_actions SET state='sent',sent_message_id=$2,reason=NULL WHERE id=$1",[pending.id,matched.id]);
   await db.query("UPDATE alibaba_conversations SET status=CASE WHEN status IN ('attention','paused') THEN status ELSE 'awaiting_reply' END,reason=CASE WHEN status IN ('attention','paused') THEN NULLIF(reason,'SEND_OUTCOME_UNKNOWN') ELSE NULL END WHERE id=$1",[conversation.id]);
  }else if(action?.id===pending.id){
   const definite=observation.sendStatus==='not_sent';
   await db.query('UPDATE alibaba_actions SET state=$2,reason=$3 WHERE id=$1',[pending.id,definite?'blocked':'outcome_unknown',definite?'SEND_NOT_CONFIRMED':'SEND_OUTCOME_UNKNOWN']);
   await db.query("UPDATE alibaba_conversations SET status=CASE WHEN $2 THEN 'attention' ELSE status END,reason=CASE WHEN $2 OR status NOT IN ('attention','paused') THEN $3 ELSE reason END WHERE id=$1",[conversation.id,definite,definite?'SEND_NOT_CONFIRMED':'SEND_OUTCOME_UNKNOWN']);
  }
 }
 if(activity)await db.query('UPDATE candidates SET last_progress_at=clock_timestamp() WHERE id=$1',[conversation.candidate_id]);
}
