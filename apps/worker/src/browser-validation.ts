import {createHash} from 'node:crypto';
import {browserObservationSchema,browserTaskSchema,categoryTrendsObservationSchema,evaluateNiche,measured,estimate,productDatabaseObservationSchema,selectBrowserProductLeader,unknown,type Evidence,type NicheInput} from '@forge-ops/domain';
import {decryptSecret,exactPayloadHash} from '@forge-ops/security';
import type {Pool} from '@forge-ops/db';
import {applyApiValidationDecision,loadCanonicalNicheEvidence,type ApiValidationContext} from './api-validation-store.ts';

const requiredTasks=['product_database','keyword_scout','historical_data','category_trends','competitive_intelligence','amazon_package'] as const;
const researchTasks=requiredTasks.slice(0,5);
type BrowserValidationResult='pass'|'reject'|'hold'|'stale'|'pending'|'not_ready';
type Receipt={
 id:string;task_id:string;task_kind:typeof requiredTasks[number];envelope:{payload:string};task_hash:string;
 body_ciphertext:string;body_sha256:string;
};

function exactCategory(value:string|null|undefined):boolean{
 return typeof value==='string'&&value.split(/\s*>\s*/).some(segment=>segment.trim().toLowerCase()==='kitchen & dining');
}
function integer(value:string|null|undefined):number|null{
 if(typeof value!=='string'||!/^\d[\d,]*$/.test(value.trim()))return null;
 const parsed=Number(value.replace(/,/g,''));
 return Number.isSafeInteger(parsed)&&parsed>=0?parsed:null;
}
function money(value:string|null|undefined):number|null{
 if(typeof value!=='string'||!/^\$\s*\d[\d,]*(?:\.\d{1,2})?$/.test(value.trim()))return null;
 const parsed=Number(value.replace(/[$,\s]/g,''));
 return Number.isFinite(parsed)&&parsed>=0?parsed:null;
}

async function readBrowserReadiness(pool:Pool,context:ApiValidationContext):Promise<{started:number;completed:number;intended:boolean}>{
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const counts=(await client.query<{started:number;completed:number}>(`SELECT count(*) FILTER(WHERE task_kind=ANY($5::text[]))::int AS started,
    count(DISTINCT task_kind) FILTER (WHERE state='completed')::int AS completed
   FROM browser_tasks WHERE candidate_id=$1 AND input_version=$2 AND settings_version=$3
    AND state IN ('queued','delivered','completed') AND task_kind=ANY($4::text[])`,[context.candidateId,context.inputVersion,context.settingsVersion,requiredTasks,researchTasks])).rows[0];
  const intended=context.snapshot.jsDailyWireCap>0&&((await client.query(`SELECT 1 FROM bridge_devices d JOIN "user" u ON u.id=d.owner_user_id
    WHERE d.revoked_at IS NULL AND u.two_factor_enabled=true AND d.reported_connected=true
     AND d.reported_at>clock_timestamp()-interval '90 seconds' AND 'product_database'=ANY(d.reported_tasks) LIMIT 1`)).rowCount??0)>0;
  await client.query('COMMIT');
  return {started:counts?.started??0,completed:counts?.completed??0,intended};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function consumeBrowserValidation(pool:Pool,context:ApiValidationContext,encryptionKey:Buffer):Promise<BrowserValidationResult>{
 const readiness=await readBrowserReadiness(pool,context);
  if(readiness.completed!==requiredTasks.length){
   if(readiness.started>0)return 'pending';
   return 'not_ready';
  }
 const receipts=(await pool.query<Receipt>(`SELECT DISTINCT ON(t.task_kind)
   r.id,t.id AS task_id,t.task_kind,t.envelope,t.task_hash,r.body_ciphertext,r.body_sha256
  FROM browser_tasks t JOIN browser_task_results r ON r.id=t.result_id AND r.task_id=t.id
  WHERE t.candidate_id=$1 AND t.input_version=$2 AND t.settings_version=$3
   AND t.task_kind=ANY($4::text[]) AND t.state='completed'
  ORDER BY t.task_kind,t.created_at DESC,t.id DESC`,
  [context.candidateId,context.inputVersion,context.settingsVersion,requiredTasks])).rows;
 if(receipts.length!==requiredTasks.length)return 'pending';
 const rawByKind=new Map<string,unknown>();
 const receiptByKind=new Map(receipts.map(receipt=>[receipt.task_kind,receipt]));
 for(const receipt of receipts){
  let raw:unknown;
  let task:ReturnType<typeof browserTaskSchema.parse>;
  try{
   raw=JSON.parse(decryptSecret(receipt.body_ciphertext,encryptionKey,'browser-task-result:'+receipt.id).toString('utf8'));
   task=browserTaskSchema.parse(JSON.parse(Buffer.from(receipt.envelope.payload,'base64url').toString('utf8')));
  }catch{throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');}
  if(exactPayloadHash(raw)!==receipt.body_sha256||createHash('sha256').update(receipt.envelope.payload).digest('hex')!==receipt.task_hash||
     task.id!==receipt.task_id||task.request.kind!==receipt.task_kind||
     !('candidateId' in task.request)||task.request.candidateId!==context.candidateId||
     !('inputVersion' in task.request)||task.request.inputVersion!==context.inputVersion||
     !('settingsVersion' in task.request)||task.request.settingsVersion!==context.settingsVersion)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  const parsed=browserObservationSchema.safeParse(raw);
  if(!parsed.success)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  const observation=parsed.data,request=task.request;
  if(request.kind==='product_database'){
   if(observation.scope!=='jungle_scout_product_database'||observation.query!==context.keyword||observation.query!==request.query||
      observation.marketplace!==request.marketplace||observation.category!==request.category||observation.discoveryCategory!==request.discoveryCategory||
      observation.productTier!==request.productTier||observation.resultLimit!==request.resultLimit)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  }else if(request.kind==='keyword_scout'){
   if(observation.scope!=='jungle_scout_keyword_scout'||observation.query!==context.keyword||observation.query!==request.query)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  }else if(request.kind==='historical_data'){
   if(observation.scope!=='jungle_scout_historical_data'||observation.query!==context.keyword||observation.query!==request.query||
      (observation.representativeAsin??null)!==request.representativeAsin)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  }else if(request.kind==='category_trends'){
   if(observation.scope!=='jungle_scout_category_trends'||observation.query!==context.keyword||observation.query!==request.query||
      (observation.representativeAsin??null)!==request.representativeAsin)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  }else if(request.kind==='competitive_intelligence'){
   if(observation.scope!=='jungle_scout_competitive_intelligence'||observation.query!==context.keyword||observation.query!==request.query)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  }else if(request.kind==='amazon_package'){
   if(observation.scope!=='amazon_product_page'||observation.asin!==request.asin)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  }else throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
  rawByKind.set(receipt.task_kind,raw);
 }
 const parsed=productDatabaseObservationSchema.safeParse(rawByKind.get('product_database'));
 const parsedCategory=categoryTrendsObservationSchema.safeParse(rawByKind.get('category_trends'));
 const receipt=receiptByKind.get('product_database'),categoryReceipt=receiptByKind.get('category_trends');
 if(!parsed.success||!parsedCategory.success||!receipt||!categoryReceipt)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
 const observation=parsed.data,sourceId='browser-task-result:'+receipt.id,observedAt=observation.observedAt;
 const populationComplete=observation.coverage==='complete'&&observation.displayedCount===observation.records.length&&observation.totalCount===observation.records.length;
 const categoriesKnown=observation.records.every(record=>typeof record.categoryPath==='string');
 const products=categoriesKnown?observation.records.filter(record=>exactCategory(record.categoryPath)):[];
 const reviews=products.map(record=>integer(record.reviews));
 const revenues=products.map(record=>money(record.revenueMonthly));
 const sourceComplete=populationComplete&&categoriesKnown&&products.length===observation.records.length&&products.length>0;
 const reviewComplete=sourceComplete&&reviews.every(value=>value!==null);
 const revenueComplete=sourceComplete&&revenues.every(value=>value!==null);
 const review700Count:Evidence<number>=reviewComplete?measured(reviews.filter(value=>value!==null&&value>=700).length,sourceId,observedAt):unknown('BROWSER_REVIEW_POPULATION_INCOMPLETE',sourceId);
 const review2000Count:Evidence<number>=reviewComplete?measured(reviews.filter(value=>value!==null&&value>=2000).length,sourceId,observedAt):unknown('BROWSER_REVIEW_POPULATION_INCOMPLETE',sourceId);
 const minimumRevenue=Number(context.snapshot.monthlyRevenueMinUsd);
 const monthlyRevenueCompetitorCount:Evidence<number>=revenueComplete&&Number.isFinite(minimumRevenue)&&minimumRevenue>=0
  ?estimate(revenues.filter(value=>value!==null&&value>=minimumRevenue).length,sourceId,observedAt)
  :unknown('BROWSER_REVENUE_POPULATION_INCOMPLETE',sourceId);
 const leader=selectBrowserProductLeader(observation);
 const leaderRecord=leader.kind==='selected'?observation.records.find(record=>record.asin===leader.asin):undefined;
 const leaderPrice=money(leaderRecord?.price);
 const topPriceUsd:Evidence<string>=leaderPrice===null?unknown('BROWSER_MARKET_LEADER_PRICE_UNCONFIRMED',sourceId):measured(String(leaderPrice),sourceId,observedAt);
 const facts=[
  {field:'review_700_count',evidence:review700Count},
  {field:'review_2000_count',evidence:review2000Count},
  {field:'monthly_revenue_competitors',evidence:monthlyRevenueCompetitorCount},
  {field:'top_price',evidence:topPriceUsd},
 ] as const;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const current=(await client.query<{valid:boolean}>(`SELECT c.stage='api_validation' AND c.input_version=$2
   AND (SELECT max(version) FROM settings_versions)=$3 AS valid FROM candidates c WHERE c.id=$1 FOR UPDATE`,
   [context.candidateId,context.inputVersion,context.settingsVersion])).rows[0];
  if(!current?.valid){await client.query('COMMIT');return 'stale';}
  for(const {field,evidence} of facts){
   await client.query(`INSERT INTO evidence(candidate_id,field,kind,value_numeric,value_text,source_id,observed_at,reason,input_version,settings_version)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE NOT EXISTS(
     SELECT 1 FROM evidence WHERE candidate_id=$1 AND field=$2 AND source_id=$6 AND input_version=$9 AND settings_version=$10)`,
    [context.candidateId,field,evidence.kind,typeof evidence.value==='number'?evidence.value:null,typeof evidence.value==='string'?evidence.value:null,evidence.sourceId,evidence.observedAt,evidence.kind==='unknown'?evidence.reason:null,context.inputVersion,context.settingsVersion]);
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 const canonical=await loadCanonicalNicheEvidence(pool,context.candidateId);
 const input:NicheInput={review700Count,review2000Count,monthlyRevenueCompetitorCount,topPriceUsd,standardSize:canonical.standardSize,differentiation:canonical.differentiation};
 const assessment=evaluateNiche(input,context.snapshot);
 const complete=[review700Count,review2000Count,monthlyRevenueCompetitorCount,topPriceUsd].every(value=>value.kind!=='unknown');
 const categoryConfirmed=parsedCategory.data.kitchenDiningConfirmation==='confirmed';
 const evidenceBlock=!categoryConfirmed?'CATEGORY_MEMBERSHIP_UNCONFIRMED':complete?null:'BROWSER_PRODUCT_DATABASE_METRICS_INCOMPLETE';
 return applyApiValidationDecision({pool,context,decision:{assessment,input,outcome:assessment.hardFail?'reject':evidenceBlock?'hold':assessment.outcome,evidenceBlock,sourceIds:[sourceId,'browser-task-result:'+categoryReceipt.id]}});
}

export async function reserveOfficialValidation(pool:Pool,context:ApiValidationContext):Promise<boolean>{
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const current=(await client.query<{valid:boolean}>(`SELECT c.stage='api_validation' AND c.input_version=$2
    AND (SELECT max(version) FROM settings_versions)=$3 AS valid FROM candidates c WHERE c.id=$1 FOR UPDATE`,
    [context.candidateId,context.inputVersion,context.settingsVersion])).rows[0]?.valid??false;
  if(!current){await client.query('COMMIT');return false;}
  await client.query(`INSERT INTO candidate_events(candidate_id,stage,input_version,detail)
    VALUES($1,'api_validation',$2,jsonb_build_object('validationTransport','official','validationSettingsVersion',$3::int))
    ON CONFLICT(candidate_id,stage,input_version) DO UPDATE SET detail=candidate_events.detail||EXCLUDED.detail`,
    [context.candidateId,context.inputVersion,context.settingsVersion]);
  await client.query('COMMIT');return true;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
