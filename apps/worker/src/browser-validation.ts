import {browserObservationSchema,evaluateNiche,measured,estimate,selectBrowserProductLeader,unknown,type Evidence,type NicheInput} from '@forge-ops/domain';
import {decryptSecret,exactPayloadHash} from '@forge-ops/security';
import type {Pool} from '@forge-ops/db';
import {applyApiValidationDecision,loadCanonicalNicheEvidence,type ApiValidationContext} from './api-validation-store.ts';

const requiredTasks=['product_database','keyword_scout','historical_data','category_trends','competitive_intelligence','amazon_package'] as const;
type BrowserValidationResult='pass'|'reject'|'hold'|'stale'|'pending'|'not_ready';
type Receipt={id:string;body_ciphertext:string;body_sha256:string};

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

export async function consumeBrowserValidation(pool:Pool,context:ApiValidationContext,encryptionKey:Buffer):Promise<BrowserValidationResult>{
 const counts=(await pool.query<{started:number;completed:number}>(`SELECT
   count(*) FILTER (WHERE task_kind='product_database')::int AS started,
   count(DISTINCT task_kind) FILTER (WHERE state='completed')::int AS completed
  FROM browser_tasks WHERE candidate_id=$1 AND input_version=$2 AND settings_version=$3
   AND task_kind=ANY($4::text[])`,
  [context.candidateId,context.inputVersion,context.settingsVersion,requiredTasks])).rows[0];
 if((counts?.completed??0)!==requiredTasks.length)return (counts?.started??0)>0?'pending':'not_ready';
 const receipt=(await pool.query<Receipt>(`SELECT r.id,r.body_ciphertext,r.body_sha256 FROM browser_tasks t
  JOIN browser_task_results r ON r.id=t.result_id WHERE t.candidate_id=$1 AND t.input_version=$2 AND t.settings_version=$3
   AND t.task_kind='product_database' AND t.state='completed' ORDER BY t.created_at DESC,t.id DESC LIMIT 1`,
  [context.candidateId,context.inputVersion,context.settingsVersion])).rows[0];
 if(!receipt)return 'not_ready';
 const categoryReceipt=(await pool.query<Receipt>(`SELECT r.id,r.body_ciphertext,r.body_sha256 FROM browser_tasks t
  JOIN browser_task_results r ON r.id=t.result_id WHERE t.candidate_id=$1 AND t.input_version=$2 AND t.settings_version=$3
   AND t.task_kind='category_trends' AND t.state='completed' ORDER BY t.created_at DESC,t.id DESC LIMIT 1`,
  [context.candidateId,context.inputVersion,context.settingsVersion])).rows[0];
 if(!categoryReceipt)return 'not_ready';
 let raw:unknown;
 let rawCategory:unknown;
 try{raw=JSON.parse(decryptSecret(receipt.body_ciphertext,encryptionKey,'browser-task-result:'+receipt.id).toString('utf8'));}
 catch{throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');}
 try{rawCategory=JSON.parse(decryptSecret(categoryReceipt.body_ciphertext,encryptionKey,'browser-task-result:'+categoryReceipt.id).toString('utf8'));}
 catch{throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');}
 if(exactPayloadHash(raw)!==receipt.body_sha256)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
 if(exactPayloadHash(rawCategory)!==categoryReceipt.body_sha256)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
 const parsed=browserObservationSchema.safeParse(raw);
 const parsedCategory=browserObservationSchema.safeParse(rawCategory);
 if(!parsed.success||parsed.data.scope!=='jungle_scout_product_database'||parsed.data.query!==context.keyword)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
 if(!parsedCategory.success||parsedCategory.data.scope!=='jungle_scout_category_trends'||parsedCategory.data.query!==context.keyword)throw new Error('BROWSER_VALIDATION_SOURCE_INVALID');
 const observation=parsed.data,sourceId='browser-task-result:'+receipt.id,observedAt=observation.observedAt;
 const populationComplete=observation.coverage==='complete'&&observation.displayedCount===observation.records.length&&observation.totalCount===observation.records.length;
 const categoriesKnown=observation.records.every(record=>typeof record.categoryPath==='string');
 const products=categoriesKnown?observation.records.filter(record=>exactCategory(record.categoryPath)):[];
 const reviews=products.map(record=>integer(record.reviews));
 const revenues=products.map(record=>money(record.revenueMonthly));
 const sourceComplete=populationComplete&&categoriesKnown&&products.length>0;
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
