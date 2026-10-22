import {readCandidateDetails,websiteContactEnabled,type Pool,type AlibabaConversationRow,type AlibabaMessageRow,type AlibabaActionRow} from '@forge-ops/db';
import {decryptSecret} from '@forge-ops/security';
import type {AlibabaWorkspace,AlibabaConversationView} from '@forge-ops/domain';

export async function readAlibabaWorkspace(pool:Pool,candidateId:string,encryptionKey:Buffer):Promise<AlibabaWorkspace> {
 const ofCandidate='conversation_id IN (SELECT id FROM alibaba_conversations WHERE candidate_id=$1)';
 const [enabled,candidate,readyRow,rows,allMessages,allActions]=await Promise.all([
  websiteContactEnabled(pool),
  readCandidateDetails(pool,candidateId,'en'),
  pool.query<{ready:boolean}>(`SELECT EXISTS(SELECT 1 FROM bridge_devices d JOIN "user" u ON u.id=d.owner_user_id JOIN browser_signing_identity k ON k.fingerprint=d.reported_key_fingerprint
  WHERE d.revoked_at IS NULL AND u.two_factor_enabled AND d.reported_connected AND d.reported_at>clock_timestamp()-interval '90 seconds'
   AND ARRAY['supplier_search','supplier_thread','supplier_send']::text[] <@ d.reported_tasks) AS ready`),
  pool.query<AlibabaConversationRow&{retired:boolean}>('SELECT c.*,alibaba_conversation_retired(c) AS retired FROM alibaba_conversations c WHERE candidate_id=$1 ORDER BY created_at,id',[candidateId]),
  pool.query<AlibabaMessageRow>(`SELECT * FROM alibaba_messages WHERE ${ofCandidate} ORDER BY sent_at,provider_message_id`,[candidateId]),
  pool.query<AlibabaActionRow>(`SELECT * FROM alibaba_actions WHERE ${ofCandidate} ORDER BY created_at,id`,[candidateId]),
 ]);
 const ready=readyRow.rows[0]?.ready===true;
 const conversations:AlibabaConversationView[]=[];
 for(const row of rows.rows){
  const messages=allMessages.rows.filter(message=>message.conversation_id===row.id);
  const actions=allActions.rows.filter(action=>action.conversation_id===row.id);
  conversations.push({id:row.id,companyName:row.company_name,companyUrl:row.company_url,productUrl:row.product_url,threadUrl:row.thread_url,status:row.status,reason:row.reason,retired:row.retired,
   lastActivityAt:row.last_activity_at?.toISOString()??null,nextCheckAt:row.next_check_at?.toISOString()??null,
   messages:messages.map(message=>({id:message.provider_message_id,direction:message.direction,body:decryptSecret(message.body_ciphertext,encryptionKey,'alibaba-message:'+message.id).toString('utf8'),sentAt:message.sent_at.toISOString()})),
   actions:actions.map(action=>({id:action.id,body:decryptSecret(action.body_ciphertext,encryptionKey,'alibaba-action:'+action.id).toString('utf8'),state:action.state,reason:action.reason,createdAt:action.created_at.toISOString()}))});
 }
 const active=conversations.filter(row=>!row.retired);
 const attention=active.find(row=>row.status==='attention');
 const unknown=active.some(row=>row.actions.some(action=>action.state==='dispatching'||action.state==='outcome_unknown'));
 const paused=active.find(row=>row.status==='paused');
 const reason=!enabled?'WEBSITE_MODE_REQUIRED':attention?.reason??(unknown?'SEND_OUTCOME_UNKNOWN':candidate?.candidate.decision!=='go'?'GO_REQUIRED':paused?.reason??(!ready?'BROWSER_OFFLINE':null));
 const status:AlibabaWorkspace['status']=attention?'attention':!enabled||!ready||candidate?.candidate.decision!=='go'||paused?'paused':active.some(row=>row.status==='negotiating')?'negotiating':active.some(row=>row.status==='queued')?'queued':active.length?'awaiting_reply':'searching';
 const activity=active.flatMap(row=>row.lastActivityAt?[row.lastActivityAt]:[]).sort();
 const checks=active.flatMap(row=>row.nextCheckAt?[row.nextCheckAt]:[]).sort();
 return {enabled,status,reason,lastActivityAt:activity.at(-1)??null,nextCheckAt:checks[0]??null,conversations};
}
