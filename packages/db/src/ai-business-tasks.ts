import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { candidateAiInput,aiBusinessInputSchema,parseAiBusinessOutput,type AiBusinessInput,type AiProductSourceReference } from "@forge-ops/domain";
type TaskSpec={readonly id:string;readonly material:string;readonly dimensions:string;readonly packaging:string;readonly requested_quantity:number;readonly ai_task_id:string|null};
async function readAiEvidence(db:Pick<Pool,'query'>,candidateId:string,versions:{readonly input:number;readonly settings:number}){
 return (await db.query<{field:string;kind:string;value_numeric:string|null;value_text:string|null}>("SELECT DISTINCT ON(field) field,kind,value_numeric::text,value_text FROM evidence WHERE candidate_id=$1 AND (input_version IS NULL OR (input_version=$2 AND settings_version=$3)) ORDER BY field,created_at DESC,id DESC",[candidateId,versions.input,versions.settings])).rows;
}
async function productReferenceMatches(db:Pick<Pool,'query'>,candidateId:string,source:AiProductSourceReference|undefined):Promise<boolean>{
 if(!source)return true;
 const row=(await db.query<{matches:boolean}>(`SELECT EXISTS(
  SELECT 1 FROM candidates c
  JOIN candidate_events e ON e.candidate_id=c.id AND e.input_version=c.input_version AND e.stage='api_validation'
  JOIN LATERAL(SELECT * FROM browser_tasks WHERE candidate_id=c.id AND task_kind='amazon_package' ORDER BY created_at DESC,id DESC LIMIT 1) t ON true
  JOIN browser_task_results r ON r.id=t.result_id
  WHERE c.id=$1 AND c.input_version=$2 AND (SELECT max(version) FROM settings_versions)=$3
   AND t.input_version=$2 AND t.settings_version=$3 AND t.state='completed'
   AND e.detail->>'representativeAsin'=$4 AND r.id=$5 AND r.body_sha256=$6
 ) AS matches`,[candidateId,source.inputVersion,source.settingsVersion,source.asin,source.receiptId,source.bodySha256])).rows[0];
 return row?.matches===true;
}
export async function prepareCandidateAiTask(pool:Pool,candidateId:string,role:AiBusinessInput['role'],productSource?:AiProductSourceReference){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const candidate=(await db.query<{input_version:number;keyword_display:string;stage:string}>('SELECT input_version,keyword_display,stage FROM candidates WHERE id=$1 FOR UPDATE',[candidateId])).rows[0];
  if(!candidate||['rejected','decision_recorded'].includes(candidate.stage)){await db.query('COMMIT');return null;}
  const version=(await db.query<{version:number}>('SELECT max(version)::int AS version FROM settings_versions')).rows[0]?.version;
  if(!version)throw new Error('SETTINGS_REQUIRED');
  if(!await productReferenceMatches(db,candidateId,productSource)){await db.query('COMMIT');return null;}
  const spec=['sourcing_analysis','rfq_draft'].includes(role)?(await db.query<TaskSpec>('SELECT id,material,dimensions,packaging,requested_quantity,ai_task_id FROM spec_revisions WHERE candidate_id=$1 ORDER BY revision DESC LIMIT 1',[candidateId])).rows[0]:undefined;
  const rows=await readAiEvidence(db,candidateId,{input:candidate.input_version,settings:version});
  const input=candidateAiInput(candidate.keyword_display,role,rows,spec?{material:spec.material,dimensions:spec.dimensions,packaging:spec.packaging,requestedQuantity:spec.requested_quantity}:null,productSource);
  if(!input){await db.query('COMMIT');return null;}
  const previous=(await db.query<{id:string;input_payload:unknown}>(`SELECT id,input_payload FROM ai_business_tasks
   WHERE candidate_id=$1 AND input_version=$2 AND settings_version=$3 AND role=$4
    AND ((spec_id IS NOT DISTINCT FROM $5::uuid AND input_payload=$6::jsonb) OR id=$7::uuid)
   ORDER BY (id=$7::uuid) DESC NULLS LAST LIMIT 1`,[candidateId,candidate.input_version,version,role,spec?.id??null,JSON.stringify(input),role==='sourcing_analysis'?spec?.ai_task_id??null:null])).rows[0];
  await db.query(`UPDATE ai_business_tasks SET state='stale',updated_at=now()
   WHERE candidate_id=$1 AND input_version=$2 AND settings_version=$3 AND role=$4
    AND spec_id IS NOT DISTINCT FROM $5::uuid AND id IS DISTINCT FROM $6::uuid AND state<>'stale'`,
   [candidateId,candidate.input_version,version,role,spec?.id??null,previous?.id??null]);
  if(previous){await db.query('COMMIT');return {id:previous.id,input:aiBusinessInputSchema.parse(previous.input_payload)};}
  const id=randomUUID();
  await db.query("INSERT INTO ai_execution_operations(id,role,mode,state) VALUES($1,$2,'activation-approved-only','pending')",[id,role]);
  await db.query('INSERT INTO ai_business_tasks(id,candidate_id,input_version,settings_version,role,input_payload,spec_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[id,candidateId,candidate.input_version,version,role,JSON.stringify(input),spec?.id??null]);
  await db.query('COMMIT');return {id,input};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function finishCandidateAiTask(pool:Pool,id:string){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const task=(await db.query<{candidate_id:string;input_version:number;settings_version:number;role:AiBusinessInput['role'];spec_id:string|null;input_payload:unknown}>('SELECT candidate_id,input_version,settings_version,role,spec_id,input_payload FROM ai_business_tasks WHERE id=$1',[id])).rows[0];
  if(!task){await db.query('COMMIT');return;}
  const candidate=(await db.query<{input_version:number;keyword_display:string}>('SELECT input_version,keyword_display FROM candidates WHERE id=$1 FOR UPDATE',[task.candidate_id])).rows[0];
  const version=(await db.query<{version:number}>('SELECT max(version)::int AS version FROM settings_versions')).rows[0]?.version;
  const operation=(await db.query<{state:string}>('SELECT state FROM ai_execution_operations WHERE id=$1',[id])).rows[0];
  const latestSpec=['sourcing_analysis','rfq_draft'].includes(task.role)?(await db.query<TaskSpec>('SELECT id,ai_task_id,material,dimensions,packaging,requested_quantity FROM spec_revisions WHERE candidate_id=$1 ORDER BY revision DESC LIMIT 1',[task.candidate_id])).rows[0]:undefined;
  const specMatches=!['sourcing_analysis','rfq_draft'].includes(task.role)||(latestSpec?.id??null)===task.spec_id||(task.role==='sourcing_analysis'&&task.spec_id===null&&latestSpec?.ai_task_id===id);
  let evidenceMatches=false;
  const productSource=aiBusinessInputSchema.parse(task.input_payload).productSource;
  if(candidate&&version&&specMatches&&await productReferenceMatches(db,task.candidate_id,productSource)){
   if(task.role==='sourcing_analysis'&&task.spec_id===null&&latestSpec?.ai_task_id===id)evidenceMatches=true;
   else{
    const rows=await readAiEvidence(db,task.candidate_id,{input:candidate.input_version,settings:version});
    const current=candidateAiInput(candidate.keyword_display,task.role,rows,latestSpec?{material:latestSpec.material,dimensions:latestSpec.dimensions,packaging:latestSpec.packaging,requestedQuantity:latestSpec.requested_quantity}:null,productSource);
    evidenceMatches=current!==null&&JSON.stringify(current)===JSON.stringify(aiBusinessInputSchema.parse(task.input_payload));
   }
  }
  const state=!candidate||candidate.input_version!==task.input_version||version!==task.settings_version||!specMatches||!evidenceMatches?'stale':operation?.state==='succeeded'?'succeeded':operation?.state.startsWith('failed')?'failed':'blocked';
  await db.query('UPDATE ai_business_tasks SET state=$2,updated_at=now() WHERE id=$1',[id,state]);
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function readCandidateAiTasks(pool:Pool,candidateId:string){
 const rows=await pool.query<{id:string;role:AiBusinessInput['role'];state:string;execution_state:string;input_payload:unknown;result_payload:unknown;updated_at:Date}>("SELECT t.id,t.role,t.state,o.state AS execution_state,t.input_payload,o.result_payload,t.updated_at FROM ai_business_tasks t JOIN candidates c ON c.id=t.candidate_id JOIN ai_execution_operations o ON o.id=t.id WHERE t.candidate_id=$1 AND t.input_version=c.input_version AND t.settings_version=(SELECT max(version) FROM settings_versions) AND (t.role NOT IN ('sourcing_analysis','rfq_draft') OR t.spec_id IS NOT DISTINCT FROM (SELECT id FROM spec_revisions WHERE candidate_id=t.candidate_id ORDER BY revision DESC LIMIT 1) OR (t.role='sourcing_analysis' AND t.id=(SELECT ai_task_id FROM spec_revisions WHERE candidate_id=t.candidate_id ORDER BY revision DESC LIMIT 1))) ORDER BY t.created_at,t.id",[candidateId]);
 return rows.rows.filter(row=>row.state!=='stale').map(row=>{const input=aiBusinessInputSchema.parse(row.input_payload);return {id:row.id,role:row.role,state:row.state,executionState:row.execution_state,input,result:row.state==='succeeded'?parseAiBusinessOutput(row.result_payload,input):null,updatedAt:row.updated_at.toISOString()};});
}
