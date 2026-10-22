import { candidateDecision, validationView, type SettingsSnapshot, type ValidationRow, type AlibabaStatus } from '@forge-ops/domain';
import type { QueryConnection } from './rfq-state.ts';

export type AlibabaContext = {
 id:string; stage:string; keyword_display:string; input_version:number; settings_version:number;
 spec_id:string|null; material:string|null; dimensions:string|null; packaging:string|null; requirements:string|null;
};
export type AlibabaConversationRow = {
 id:string; candidate_id:string; spec_id:string|null; input_version:number; settings_version:number;
 company_key:string; company_name:string; company_url:string; product_url:string; source_receipt_id:string;
 account_id:string|null; provider_thread_id:string|null; thread_url:string|null;
 status:Exclude<AlibabaStatus,'searching'>; reason:string|null; last_activity_at:Date|null; next_check_at:Date|null; created_at:Date;
};
export type AlibabaMessageRow = {
 id:string; conversation_id:string; provider_message_id:string; direction:'inbound'|'outbound';
 body_ciphertext:string; body_sha256:string; sent_at:Date; receipt_id:string;
};
export type AlibabaActionRow = {
 id:string; conversation_id:string; candidate_id:string; spec_id:string|null; input_version:number; settings_version:number;
 kind:'initial'|'followup'; inbound_message_id:string|null; body_ciphertext:string; body_sha256:string;
 state:'pending'|'dispatching'|'sent'|'outcome_unknown'|'blocked'|'cancelled'; reason:string|null;
 dispatch_task_id:string|null; sent_message_id:string|null; started_at:Date|null; created_at:Date;
};
export async function websiteContactEnabled(db:QueryConnection):Promise<boolean> {
 return (await db.query<{enabled:boolean}>("SELECT snapshot->>'supplierContactMode'='website' AS enabled FROM settings_versions ORDER BY version DESC LIMIT 1")).rows[0]?.enabled===true;
}
// Caller holds forge.settings; locking the candidate also serializes company limits and new actions.
export async function lockAlibabaContext(db:QueryConnection,candidateId:string) {
 const row=(await db.query<AlibabaContext&{blocked_reason:string|null;snapshot:SettingsSnapshot}>(`SELECT c.id,c.stage,c.keyword_display,c.input_version,c.blocked_reason,v.version AS settings_version,v.snapshot,
  s.id AS spec_id,s.material,s.dimensions,s.packaging,s.requirements FROM candidates c
  JOIN LATERAL(SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
  LEFT JOIN LATERAL(SELECT * FROM spec_revisions WHERE candidate_id=c.id ORDER BY revision DESC LIMIT 1) s ON true
  WHERE c.id=$1 FOR UPDATE OF c`,[candidateId])).rows[0];
 if(!row)return {ready:false as const,reason:'CANDIDATE_MISSING'};
 if(row.snapshot.supplierContactMode!=='website')return {ready:false as const,reason:'WEBSITE_MODE_REQUIRED'};
 const evaluation=(await db.query<ValidationRow>("SELECT * FROM evaluations WHERE candidate_id=$1 AND kind IN ('niche','api_validation') ORDER BY created_at DESC,id DESC LIMIT 1",[candidateId])).rows[0];
 const validation=validationView(evaluation,row.input_version,row.settings_version);
 if(candidateDecision({phase:validation.phase,status:validation.status,marketRisk:validation.marketRisk,settings:row.snapshot})!=='go')return {ready:false as const,reason:'GO_REQUIRED'};
 if(!['sourcing','rfq_draft','awaiting_contact_approval','sending_rfq','awaiting_quote','economics_review'].includes(row.stage))return {ready:false as const,reason:'STAGE_NOT_READY'};
 if(row.blocked_reason&&!['web_session','external_outcome_unknown','credential','evidence'].includes(row.blocked_reason))return {ready:false as const,reason:'CANDIDATE_BLOCKED'};
 return {ready:true as const,source:row};
}
export async function refreshAlibabaStage(db:QueryConnection,candidateId:string) {
 await db.query(`WITH summary AS (SELECT count(*) AS total,
  count(*) FILTER(WHERE status='attention') AS attention,
  count(*) FILTER(WHERE status IN ('queued','negotiating')) AS pending,
  count(*) FILTER(WHERE status='awaiting_reply') AS waiting,
  count(*) FILTER(WHERE status='paused') AS paused
  FROM alibaba_conversations c WHERE candidate_id=$1 AND NOT alibaba_conversation_retired(c))
 UPDATE candidates SET stage=CASE WHEN summary.total=0 THEN 'sourcing' WHEN summary.attention>0 THEN 'economics_review' WHEN summary.pending>0 THEN 'sending_rfq' WHEN summary.waiting>0 THEN 'awaiting_quote' ELSE stage END,
  blocked_reason=CASE WHEN EXISTS(SELECT 1 FROM alibaba_actions WHERE candidate_id=$1 AND state IN ('dispatching','outcome_unknown')) THEN 'external_outcome_unknown'
   WHEN summary.attention>0 THEN 'evidence' WHEN summary.paused>0 THEN blocked_reason WHEN blocked_reason IN ('external_outcome_unknown','credential','evidence') THEN NULL ELSE blocked_reason END
 FROM summary WHERE id=$1 AND EXISTS(SELECT 1 FROM alibaba_conversations WHERE candidate_id=$1) AND stage IN ('sourcing','rfq_draft','awaiting_contact_approval','sending_rfq','awaiting_quote','economics_review')`,[candidateId]);
}
export async function recoverAlibabaOutcomes(db:QueryConnection) {
 const changed=await db.query<{conversation_id:string;candidate_id:string}>(`UPDATE alibaba_actions SET state='outcome_unknown',reason='SEND_OUTCOME_UNKNOWN'
  WHERE state='dispatching' AND started_at<=clock_timestamp()-interval '5 minutes' RETURNING conversation_id,candidate_id`);
 for(const row of changed.rows){
  await db.query("UPDATE alibaba_conversations SET reason=CASE WHEN status IN ('attention','paused') THEN reason ELSE 'SEND_OUTCOME_UNKNOWN' END,next_check_at=clock_timestamp() WHERE id=$1",[row.conversation_id]);
  await refreshAlibabaStage(db,row.candidate_id);
 }
 return changed.rowCount??0;
}
export async function registerAlibabaCompanies(db:QueryConnection,input:{source:AlibabaContext;receiptId:string;companies:readonly {key:string;name:string;companyUrl:string;productUrl:string}[]}) {
 let count=(await db.query<{count:number}>('SELECT count(*)::int AS count FROM alibaba_conversations c WHERE candidate_id=$1 AND NOT alibaba_conversation_retired(c)',[input.source.id])).rows[0]?.count??0;
 let added=0;
 for(const company of input.companies){
  if(count>=3)break;
  const result=await db.query(`INSERT INTO alibaba_conversations(candidate_id,spec_id,input_version,settings_version,company_key,company_name,company_url,product_url,source_receipt_id)
   SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE NOT EXISTS(SELECT 1 FROM alibaba_conversations WHERE company_key=$5)
   ON CONFLICT(candidate_id,company_key) DO NOTHING`,[input.source.id,input.source.spec_id,input.source.input_version,input.source.settings_version,company.key,company.name,company.companyUrl,company.productUrl,input.receiptId]);
  count+=result.rowCount??0;added+=result.rowCount??0;
 }
 if(added)await refreshAlibabaStage(db,input.source.id);
 return added;
}
