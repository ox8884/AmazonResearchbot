import type { PgBoss } from "pg-boss";
import { JOB_ADVANCE, txAdapter } from "./queue.ts";
import { randomUUID } from "node:crypto";
import { lockActiveBridgeDevice, type Pool } from "@forge-ops/db";
import { browserObservationSchema, browserTaskSchema, supplierCaptureSchema, supplierDetailCapture, parseAmazonPackageMeasurements, assessStandardSize, STANDARD_SIZE_POLICY, selectBrowserProductLeader, type SupplierCapture } from "@forge-ops/domain";
import { insertSupplierCapture, alibabaCompanyKey, alibabaProductKey } from "@forge-ops/integrations/sourcing/capture";
import { encryptSecret, exactPayloadHash } from "@forge-ops/security";
import { lockTaskSource, type BrowserTaskRow } from "./browser-task-store.ts";
import {recordSearchExportResult} from './search-export-result.ts';
import {parseAmazonMarketSource} from '@forge-ops/integrations/amazon/market-source';

export async function acceptBrowserTaskResult(pool:Pool,input:{
 readonly deviceId:string;readonly taskId:string;readonly taskHash:string;readonly observation:unknown;readonly encryptionKey:Buffer;
},boss:PgBoss) {
 const parsed=browserObservationSchema.safeParse(input.observation);
 if(!parsed.success)return {kind:"invalid" as const};
 if(parsed.data.scope==="first_results_page"){
  const queries=new URL(parsed.data.sourcePageUrl).searchParams.getAll("SearchText");
  if(queries.length!==1||queries[0]!==parsed.data.query)return {kind:"invalid" as const};
 }
 const observation=parsed.data,bodyHash=exactPayloadHash(observation),db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  if(!await lockActiveBridgeDevice(db,input.deviceId)){await db.query("COMMIT");return {kind:"not_found" as const};}
  const task=(await db.query<BrowserTaskRow>("SELECT * FROM browser_tasks WHERE id=$1 AND device_id=$2 FOR UPDATE",[input.taskId,input.deviceId])).rows[0];
  if(!task){await db.query("COMMIT");return {kind:"not_found" as const};}
  if(task.task_hash!==input.taskHash){await db.query("COMMIT");return {kind:"conflict" as const};}
  const existing=(await db.query<{id:string;body_sha256:string;capture_ids:string[]}>("SELECT id,body_sha256,capture_ids FROM browser_task_results WHERE task_id=$1",[task.id])).rows[0];
  if(existing){
   await db.query("COMMIT");
   return existing.body_sha256===bodyHash?{kind:"duplicate" as const,receiptId:existing.id,resultHash:existing.body_sha256,captureIds:existing.capture_ids}:{kind:"conflict" as const};
  }
  if(task.search_run_id!==null){
   const result=await recordSearchExportResult(db,task,observation,bodyHash,boss,input.encryptionKey);
   await db.query('COMMIT');return result;
  }
  const payload=browserTaskSchema.parse(JSON.parse(Buffer.from(task.envelope.payload,"base64url").toString("utf8"))),request=payload.request;
  const source=await lockTaskSource(db,task);
  const observed=Date.parse(observation.observedAt),now=Date.now();
  if(request.kind==="saved_search_export"||task.state!=="delivered"||task.expires_at.getTime()<=now||!source||
     payload.id!==task.id||payload.deviceId!==task.device_id||request.candidateId!==task.candidate_id||
     (request.kind!=='amazon_package'&&request.kind!=='amazon_search'&&request.kind!=='product_database'&&request.kind!=='keyword_scout'&&request.kind!=='historical_data'&&request.kind!=='category_trends'&&request.kind!=='competitive_intelligence'&&request.specId!==task.spec_id)||request.inputVersion!==task.input_version||request.settingsVersion!==task.settings_version||
     observed>now||observed<Date.parse(payload.issuedAt)||observed>Date.parse(payload.expiresAt)){
   if(task.state==='delivered')await db.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[task.id]);
   await db.query("COMMIT");return {kind:"stale" as const};
  }
  const receiptId=randomUUID(),captureIds:string[]=[];
  if(request.kind==='competitive_intelligence'){
   if(source.readKind!=='competitive_intelligence'||observation.scope!=='jungle_scout_competitive_intelligence'||observation.query!==request.query){await db.query('COMMIT');return {kind:'invalid' as const};}
  }else if(request.kind==='category_trends'){
   if(source.readKind!=='category_trends'||observation.scope!=='jungle_scout_category_trends'||observation.query!==request.query||(observation.representativeAsin??null)!==request.representativeAsin){await db.query('COMMIT');return {kind:'invalid' as const};}
  }else if(request.kind==='historical_data'){
   if(source.readKind!=='historical_data'||observation.scope!=='jungle_scout_historical_data'||observation.query!==request.query||(observation.representativeAsin??null)!==request.representativeAsin){await db.query('COMMIT');return {kind:'invalid' as const};}
  }else if(request.kind==='keyword_scout'){
   if(source.readKind!=='keyword_scout'||observation.scope!=='jungle_scout_keyword_scout'||observation.query!==request.query){await db.query('COMMIT');return {kind:'invalid' as const};}
  }else if(request.kind==='product_database'){
   if(source.readKind!=='product_database'||observation.scope!=='jungle_scout_product_database'||observation.query!==request.query||
      observation.marketplace!==request.marketplace||observation.category!==request.category||
      observation.discoveryCategory!==request.discoveryCategory||observation.productTier!==request.productTier||
      observation.resultLimit!==request.resultLimit){await db.query('COMMIT');return {kind:'invalid' as const};}
   const current=(await db.query<{asin:string|null}>(`SELECT detail->>'representativeAsin' AS asin
    FROM candidate_events WHERE candidate_id=$1 AND stage='api_validation' AND input_version=$2
    LIMIT 1`,[task.candidate_id,task.input_version])).rows[0];
   if(!current?.asin){
    const leader=selectBrowserProductLeader(observation);
    if(leader.kind==='selected'){
     await db.query(`INSERT INTO candidate_events(candidate_id,stage,input_version,detail)
      VALUES($1,'api_validation',$2,$3::jsonb)
      ON CONFLICT(candidate_id,stage,input_version) DO UPDATE
      SET detail=candidate_events.detail || EXCLUDED.detail
      WHERE COALESCE(candidate_events.detail->>'representativeAsin','')=''
      `,[task.candidate_id,task.input_version,JSON.stringify({representativeAsin:leader.asin,selectionMethod:'browser_product_database_revenue',selectionRevenue:leader.revenueText,selectionSourceId:'browser-task-result:'+receiptId})]);
     await db.query("INSERT INTO audit_events(actor,action,target) SELECT owner_user_id,'representative_asin_auto_selected',$2 FROM bridge_devices WHERE id=$1",[input.deviceId,task.candidate_id]);
    }
   }
  }else if(request.kind==='amazon_search'){
   if(source.readKind!=='amazon_search'||!parseAmazonMarketSource(observation,request.query)){await db.query('COMMIT');return {kind:'invalid' as const};}
  }else if(request.kind==='amazon_package'){
   if(source.readKind!=='amazon_package'||source.spec_id!==null||task.spec_id!==null||observation.scope!=='amazon_product_page'||observation.asin!==request.asin||source.asin!==request.asin){await db.query('COMMIT');return {kind:'stale' as const};}
   const measurements=parseAmazonPackageMeasurements(request.asin,{sourcePageUrl:observation.sourcePageUrl,observedAt:observation.observedAt,rows:observation.rows.map(({label,value})=>({label,value}))});
   const result=assessStandardSize(request.asin,measurements);
   await db.query(`INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at,reason,input_version,settings_version)
    VALUES($1,'standard_size',$2,$3,$4,$5,$6,$7,$8)`,[task.candidate_id,result.kind,result.kind==='unknown'?null:String(result.value),
     'browser-task-result:'+receiptId+':'+STANDARD_SIZE_POLICY.id,result.observedAt,result.kind==='unknown'?result.reason:null,task.input_version,task.settings_version]);
  }else{
  if(source.spec_id===null||task.spec_id===null){await db.query('COMMIT');return {kind:'stale' as const};}
  let captures:SupplierCapture[],captureMethod:"aside_search_result"|"aside_product_detail";
  const scope={candidateId:task.candidate_id,specId:task.spec_id,inputVersion:task.input_version,settingsVersion:task.settings_version};
  if(request.kind==="supplier_search"&&observation.scope==="first_results_page"&&task.source_capture_id===null&&observation.query===request.query){
   captureMethod="aside_search_result";
   captures=observation.records.map(row=>supplierCaptureSchema.parse({...scope,searchQuery:observation.query,
    companyUrl:row.companyUrl,productUrl:row.productUrl,observedAt:observation.observedAt,pageText:row.pageText,
    companyName:row.companyName,email:null,observedSpec:{material:null,dimensions:null,packaging:null,requirements:null}}));
  }else if(request.kind==="supplier_detail"&&observation.scope==="supplier_product_page"){
   const parent=source.sourceCapture;
   if(!parent||parent.id!==request.sourceCaptureId||task.source_capture_id!==parent.id||request.companyName!==parent.company_name||observation.companyName!==parent.company_name||
     alibabaCompanyKey(request.companyUrl)!==alibabaCompanyKey(parent.company_url)||alibabaCompanyKey(observation.companyUrl)!==alibabaCompanyKey(parent.company_url)||
     alibabaProductKey(request.productUrl)!==alibabaProductKey(parent.product_url)||alibabaProductKey(observation.sourcePageUrl)!==alibabaProductKey(parent.product_url)){
    await db.query("COMMIT");return {kind:"stale" as const};
   }
   captureMethod="aside_product_detail";
   captures=[supplierDetailCapture(observation,{...scope,searchQuery:parent.search_query})];
  }else{await db.query("COMMIT");return {kind:"stale" as const};}
  for(const capture of captures){
   const stored=await insertSupplierCapture(db,{capture,spec:source,encryptionKey:input.encryptionKey,sourcePageUrl:observation.sourcePageUrl,captureMethod});
   captureIds.push(stored.captureId);
  }
  }
  const ciphertext=encryptSecret(Buffer.from(JSON.stringify(observation)),input.encryptionKey,"browser-task-result:"+receiptId);
  await db.query("INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids) VALUES($1,$2,$3,$4,$5)",[receiptId,task.id,bodyHash,ciphertext,[...new Set(captureIds)]]);
  await db.query("UPDATE browser_tasks SET state='completed',result_id=$2 WHERE id=$1",[task.id,receiptId]);
  await db.query("UPDATE candidates SET blocked_reason=NULL,last_progress_at=now() WHERE id=$1 AND blocked_reason='web_session'",[task.candidate_id]);
  await db.query("INSERT INTO audit_events(actor,action,target) SELECT owner_user_id,'browser_result_recorded',$2 FROM bridge_devices WHERE id=$1",[input.deviceId,receiptId]);
  const next=await boss.send(JOB_ADVANCE,{candidateId:task.candidate_id,stage:source.stage,inputVersion:task.input_version},{db:txAdapter(db)});
  if(!next)throw new Error("PIPELINE_ENQUEUE_FAILED");
  await db.query("COMMIT");
  return {kind:"accepted" as const,receiptId,resultHash:bodyHash,captureIds:[...new Set(captureIds)]};
 }catch(error){await db.query("ROLLBACK");throw error;}
 finally{db.release();}
}
