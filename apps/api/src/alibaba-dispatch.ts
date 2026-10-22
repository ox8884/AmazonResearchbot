import {createHash} from 'node:crypto';
import {lockActiveBridgeDevice,lockAlibabaContext,refreshAlibabaStage,type QueryConnection,type Pool,type AlibabaConversationRow,type AlibabaActionRow,type AlibabaMessageRow} from '@forge-ops/db';
import {browserTaskSchema} from '@forge-ops/domain';
import type {CandidateBrowserTaskRow} from './browser-task-store.ts';

export async function readAlibabaTaskBinding(db:QueryConnection,task:CandidateBrowserTaskRow) {
 const payload=browserTaskSchema.parse(JSON.parse(Buffer.from(task.envelope.payload,'base64url').toString('utf8'))),request=payload.request;
 if(request.kind!=='supplier_thread'&&request.kind!=='supplier_send')return null;
 const conversation=(await db.query<AlibabaConversationRow>('SELECT c.* FROM alibaba_conversations c WHERE id=$1 AND NOT alibaba_conversation_retired(c) FOR UPDATE',[task.conversation_id])).rows[0];
 if(!conversation||payload.id!==task.id||payload.deviceId!==task.device_id||request.kind!==task.task_kind||request.conversationId!==conversation.id||request.candidateId!==task.candidate_id||conversation.candidate_id!==task.candidate_id||request.specId!==task.spec_id||request.specId!==conversation.spec_id||request.inputVersion!==task.input_version||request.inputVersion!==conversation.input_version||request.settingsVersion!==task.settings_version||request.settingsVersion!==conversation.settings_version||request.companyName!==conversation.company_name||request.companyUrl!==conversation.company_url||request.productUrl!==conversation.product_url)return null;
 if(request.threadId!==null&&request.threadId!==conversation.provider_thread_id)return null;
 if(request.accountId!==null&&request.accountId!==conversation.account_id)return null;
 if(request.kind==='supplier_send'&&request.accountId!==conversation.account_id)return null;
 const action=request.kind==='supplier_send'?(await db.query<AlibabaActionRow>('SELECT * FROM alibaba_actions WHERE id=$1 FOR UPDATE',[task.action_id])).rows[0]:undefined;
 if(request.kind==='supplier_send'&&(!action||request.actionId!==action.id||action.conversation_id!==conversation.id||action.candidate_id!==task.candidate_id||action.spec_id!==task.spec_id||action.input_version!==task.input_version||action.settings_version!==task.settings_version||action.body_sha256!==createHash('sha256').update(request.body).digest('hex')))return null;
 if(request.kind==='supplier_send'&&action){
  if(action.kind==='initial'&&request.basedOnInbound)return null;
  if(action.kind==='followup'){
   const anchor=request.basedOnInbound;
   if(!anchor){if(action.dispatch_task_id!==task.id||action.started_at===null)return null;}
   else{
    const inbound=(await db.query<AlibabaMessageRow>("SELECT * FROM alibaba_messages WHERE id=$1 AND conversation_id=$2 AND direction='inbound'",[action.inbound_message_id,conversation.id])).rows[0];
    if(!inbound||anchor.providerMessageId!==inbound.provider_message_id||Date.parse(anchor.sentAt)!==inbound.sent_at.getTime()||anchor.bodySha256!==inbound.body_sha256)return null;
   }
  }
 }
 return {payload,request,conversation,action};
}
export async function lockAlibabaTaskSource(db:QueryConnection,task:CandidateBrowserTaskRow,known?:Awaited<ReturnType<typeof readAlibabaTaskBinding>>) {
 const binding=known??await readAlibabaTaskBinding(db,task);
 if(!binding)return null;
 if(binding.action){
  const gate=await lockAlibabaContext(db,task.candidate_id);
  if(binding.action.state!=='pending'||binding.conversation.status==='attention'||binding.conversation.status==='paused'||!binding.conversation.provider_thread_id||!binding.conversation.account_id||!gate.ready||gate.source.spec_id!==task.spec_id||gate.source.input_version!==task.input_version||gate.source.settings_version!==task.settings_version)return null;
  if(binding.action.kind==='followup'){
   const latest=(await db.query<AlibabaMessageRow>("SELECT * FROM alibaba_messages WHERE conversation_id=$1 AND direction='inbound' ORDER BY sent_at DESC,provider_message_id DESC LIMIT 1",[binding.conversation.id])).rows[0];
   const buyerReply=latest&&await db.query("SELECT 1 FROM alibaba_messages WHERE conversation_id=$1 AND direction='outbound' AND sent_at>=$2 LIMIT 1",[binding.conversation.id,latest.sent_at]);
   if(!latest||latest.id!==binding.action.inbound_message_id||buyerReply?.rowCount){
    await db.query("UPDATE alibaba_actions SET state='blocked',reason='NEGOTIATION_CONTEXT_CHANGED' WHERE id=$1 AND state='pending'",[binding.action.id]);
    await db.query("UPDATE alibaba_conversations SET status='attention',reason='NEGOTIATION_CONTEXT_CHANGED',next_check_at=NULL WHERE id=$1",[binding.conversation.id]);
    await refreshAlibabaStage(db,binding.conversation.candidate_id);return null;
   }
  }
 }
 return {id:task.candidate_id,stage:'sourcing' as const,spec_id:task.spec_id,input_version:task.input_version,settings_version:task.settings_version,sourceCapture:null,readKind:'alibaba' as const};
}
export async function beginAlibabaDispatch(pool:Pool,input:{deviceId:string;taskId:string;taskHash:string}) {
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const deny=async(reason:string)=>{await db.query('COMMIT');return {allowed:false as const,reason};};
  if(!await lockActiveBridgeDevice(db,input.deviceId))return await deny('DEVICE_REJECTED');
  const task=(await db.query<CandidateBrowserTaskRow>('SELECT * FROM browser_tasks WHERE id=$1 AND device_id=$2 FOR UPDATE',[input.taskId,input.deviceId])).rows[0];
  if(!task||task.task_kind!=='supplier_send'||task.task_hash!==input.taskHash)return await deny('TASK_BINDING_REJECTED');
  const binding=await readAlibabaTaskBinding(db,task);
  if(!binding?.action)return await deny('TASK_BINDING_REJECTED');
  if(binding.action.state!=='pending'||binding.action.started_at)return await deny('ACTION_ALREADY_STARTED');
  if(task.state!=='delivered'||task.expires_at.getTime()<=Date.now())return await deny('TASK_EXPIRED');
  const device=await db.query(`SELECT 1 FROM bridge_devices d JOIN browser_signing_identity k ON k.fingerprint=d.reported_key_fingerprint
   WHERE d.id=$1 AND d.reported_connected AND d.reported_at>clock_timestamp()-interval '90 seconds' AND 'supplier_send'=ANY(d.reported_tasks)`,[input.deviceId]);
  if(!device.rowCount)return await deny('BROWSER_OFFLINE');
  // The binding rows are already locked FOR UPDATE in this transaction, so reuse them instead of re-reading.
  if(!await lockAlibabaTaskSource(db,task,binding))return await deny('SOURCE_CHANGED');
  const changed=await db.query("UPDATE alibaba_actions SET state='dispatching',dispatch_task_id=$2,started_at=clock_timestamp(),reason=NULL WHERE id=$1 AND state='pending' AND started_at IS NULL RETURNING id",[binding.action.id,task.id]);
  if(!changed.rowCount)return await deny('ACTION_ALREADY_STARTED');
  await db.query("INSERT INTO audit_events(actor,action,target) SELECT owner_user_id,'alibaba_send_started',$2 FROM bridge_devices WHERE id=$1",[input.deviceId,binding.action.id]);
  await db.query('COMMIT');return {allowed:true as const};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
