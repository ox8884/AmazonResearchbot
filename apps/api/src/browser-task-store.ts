import { lockActiveBridgeDevice, lockSourcingContext, lockPackageContext, lockMarketContext, readSupplierSearchSource, type Pool, type QueryConnection } from "@forge-ops/db";
import { browserTaskSchema,type BrowserReadTask } from '@forge-ops/domain';
import {lockSearchTaskSource} from './search-task-source.ts';
type TaskBase = {
 id:string;device_id:string;task_kind:BrowserReadTask['request']['kind'];
 envelope:{version:1;payload:string;signature:string};task_hash:string;
 state:"queued"|"delivered"|"completed"|"cancelled";expires_at:Date;result_id:string|null;
};
export type CandidateBrowserTaskRow=TaskBase&{search_run_id:null;candidate_id:string;source_capture_id:string|null;spec_id:string|null;input_version:number;settings_version:number};
export type SearchBrowserTaskRow=TaskBase&{search_run_id:string;candidate_id:null;source_capture_id:null;spec_id:null;input_version:null;settings_version:null};
export type BrowserTaskRow=CandidateBrowserTaskRow|SearchBrowserTaskRow;
const jungleScoutBrowserTaskKinds = [
 'saved_search_export',
 'product_database',
 'keyword_scout',
 'historical_data',
 'category_trends',
 'competitive_intelligence',
] as const;

async function readJungleScoutBrowserBudget(db:QueryConnection):Promise<number>{
 const setting=(await db.query<{cap:number|null}>("SELECT (snapshot->>'jsDailyWireCap')::int AS cap FROM settings_versions ORDER BY version DESC LIMIT 1")).rows[0];
 const cap=setting?.cap??0;
 if(!Number.isSafeInteger(cap)||cap<=0)return 0;
 const used=(await db.query<{used:number}>(`SELECT count(*)::int AS used FROM browser_tasks
  WHERE task_kind=ANY($1::text[]) AND (state IN ('delivered','completed') OR (state='cancelled' AND delivered_at IS NOT NULL))
   AND created_at>=date_trunc('day',clock_timestamp())`,[jungleScoutBrowserTaskKinds])).rows[0]?.used??0;
 return Math.max(0,cap-used);
}
export async function lockTaskSource(db:QueryConnection,task:CandidateBrowserTaskRow) {
 const request=browserTaskSchema.parse(JSON.parse(Buffer.from(task.envelope.payload,'base64url').toString('utf8'))).request;
 if(request.kind!==task.task_kind)return null;
 if(request.kind==='amazon_search'||request.kind==='product_database'||request.kind==='keyword_scout'||request.kind==='historical_data'||request.kind==='category_trends'||request.kind==='competitive_intelligence'){
  const source=await lockMarketContext(db,task.candidate_id);
  if(!source||source.input_version!==task.input_version||source.settings_version!==task.settings_version||request.query!==source.market_query||request.candidateId!==source.id||request.inputVersion!==source.input_version||request.settingsVersion!==source.settings_version)return null;
  return {...source,sourceCapture:null,readKind:request.kind};
 }
 if(task.spec_id===null){
  const source=await lockPackageContext(db,task.candidate_id);
  if(!source||source.input_version!==task.input_version||source.settings_version!==task.settings_version||task.source_capture_id!==null)return null;
  if(request.kind!=='amazon_package'||request.asin!==source.asin||request.candidateId!==source.id||request.inputVersion!==source.input_version||request.settingsVersion!==source.settings_version)return null;
  return {...source,sourceCapture:null,readKind:'amazon_package' as const};
 }
 const source=await lockSourcingContext(db,task.candidate_id);
 if(!source||source.spec_id!==task.spec_id||source.input_version!==task.input_version||source.settings_version!==task.settings_version)return null;
 const sourceCapture=task.source_capture_id?await readSupplierSearchSource(db,task.source_capture_id,source):null;
 return task.source_capture_id&&!sourceCapture?null:{...source,sourceCapture,readKind:'supplier' as const};
}
export async function claimBrowserTask(pool:Pool,deviceId:string) {
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  if(!await lockActiveBridgeDevice(db,deviceId)){await db.query("COMMIT");return {kind:"rejected" as const};}
  await db.query("UPDATE browser_tasks SET state='cancelled' WHERE device_id=$1 AND state IN ('queued','delivered') AND expires_at<=clock_timestamp()",[deviceId]);
  const researchRemaining=await readJungleScoutBrowserBudget(db);
  for(let checked=0;checked<20;checked++){
   const row=(await db.query<BrowserTaskRow>(`SELECT t.* FROM browser_tasks t
    WHERE t.device_id=$1 AND (t.state='queued' OR (t.state='delivered' AND t.delivered_at<=clock_timestamp()-interval '150 seconds'))
     AND (t.task_kind <> ALL($2::text[]) OR $3::boolean)
   ORDER BY
     (SELECT max(prior.delivered_at) FROM browser_tasks prior
      WHERE prior.task_kind=t.task_kind
       AND prior.candidate_id IS NOT DISTINCT FROM t.candidate_id
       AND prior.search_run_id IS NOT DISTINCT FROM t.search_run_id
       AND prior.spec_id IS NOT DISTINCT FROM t.spec_id
       AND prior.source_capture_id IS NOT DISTINCT FROM t.source_capture_id
       AND prior.input_version IS NOT DISTINCT FROM t.input_version
       AND prior.settings_version IS NOT DISTINCT FROM t.settings_version) ASC NULLS FIRST,
     t.created_at,t.id LIMIT 1 FOR UPDATE OF t`,[deviceId,jungleScoutBrowserTaskKinds,researchRemaining>0])).rows[0];
   if(!row){await db.query("COMMIT");return {kind:"idle" as const};}
   const source=row.search_run_id!==null?await lockSearchTaskSource(db,row):await lockTaskSource(db,row);
   if(!source){await db.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[row.id]);continue;}
   const delivered=await db.query("UPDATE browser_tasks SET state='delivered',delivered_at=now() WHERE id=$1 AND (state='queued' OR (state='delivered' AND delivered_at<=clock_timestamp()-interval '150 seconds')) AND expires_at>clock_timestamp() RETURNING id",[row.id]);
   if(!delivered.rowCount){await db.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1 AND state IN ('queued','delivered')",[row.id]);continue;}
   await db.query("COMMIT");
   return {kind:"task" as const,taskId:row.id,taskHash:row.task_hash,envelope:row.envelope};
  }
  await db.query("COMMIT");return {kind:"idle" as const};
 }catch(error){await db.query("ROLLBACK");throw error;}
 finally{db.release();}
}
export async function readBrowserTask(pool:Pool,deviceId:string,taskId:string) {
 const row=(await pool.query<{id:string;state:string;task_hash:string;result_id:string|null;expires_at:Date;body_sha256:string|null}>(
  'SELECT t.id,t.state,t.task_hash,t.result_id,t.expires_at,r.body_sha256 FROM browser_tasks t LEFT JOIN browser_task_results r ON r.id=t.result_id JOIN bridge_devices d ON d.id=t.device_id JOIN "user" u ON u.id=d.owner_user_id WHERE t.id=$1 AND t.device_id=$2 AND d.revoked_at IS NULL AND u.two_factor_enabled=true',
  [taskId,deviceId])).rows[0];
 return row?{taskId:row.id,state:row.state,taskHash:row.task_hash,receiptId:row.result_id,resultHash:row.body_sha256,expiresAt:row.expires_at.toISOString()}:null;
}
