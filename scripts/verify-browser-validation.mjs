import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openAcceptance} from './support/acceptance.mjs';
import {advanceCandidate} from '../apps/worker/src/advance-candidate.ts';
import {denyTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
import {encryptSecret} from '../packages/security/src/secrets.ts';
import {exactPayloadHash} from '../packages/security/src/approval-hash.ts';

const test=await openAcceptance({databaseKey:'browser-validation-'+Date.now()});
try{
 const pairing=await test.call('/api/bridge/pairings',{});
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Browser validation fixture'});
 assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id;
 const settings=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 const key=Buffer.from(test.encryptionKeyHex,'hex');
 const taskKinds=['product_database','keyword_scout','historical_data','category_trends','competitive_intelligence','amazon_package'];
 const records=Array.from({length:5},(_,index)=>{
  const asin='B0BV'+String(index+1).padStart(6,'0');
  const revenue='$'+String(20000-index*1000);
  const price=index===0?'$25.00':'$22.00';
  const reviews=String(100+index);
  return {asin,title:'Synthetic kitchen product '+index,categoryPath:'Home & Kitchen > Kitchen & Dining',reviews,revenueMonthly:revenue,price,sourceText:[asin,'Synthetic kitchen product '+index,'Home & Kitchen > Kitchen & Dining',reviews,revenue,price].join(' ')};
 });
 async function candidate(label,coverage='complete'){
  const query='browser validation '+label+' '+test.runId;
  const id=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[query])).rows[0].id;
  await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[id,JSON.stringify({representativeAsin:records[0].asin})]);
  await test.pool.query(`INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at,reason,input_version,settings_version)
   VALUES($1,'standard_size','measured','true','browser-package-fixture',now(),NULL,1,$2)`,[id,settings.version]);
  const product={protocol:1,kind:'captured',scope:'jungle_scout_product_database',query,marketplace:'us',category:'Kitchen & Dining',discoveryCategory:'Home & Kitchen',productTier:'Standard',resultLimit:100,displayedCount:records.length,totalCount:coverage==='complete'?records.length:records.length+1,coverage,sourcePageUrl:'https://members.junglescout.com/#/database',observedAt:new Date().toISOString(),snapshot:'Synthetic complete Product Database population',records};
  for(const kind of taskKinds){
   const taskId=randomUUID(),receiptId=randomUUID();
   await test.pool.query(`INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,state,expires_at,delivered_at,task_kind)
    VALUES($1,$2,$3,NULL,1,$4,'{}'::jsonb,repeat('a',64),'delivered',now()+interval '5 minutes',now(),$5)`,[taskId,deviceId,id,settings.version,kind]);
   const category={protocol:1,kind:'captured',scope:'jungle_scout_category_trends',query,sourcePageUrl:'https://members.junglescout.com/#/category-trends',observedAt:new Date().toISOString(),snapshot:'Kitchen & Dining',representativeAsin:records[0].asin,categories:[{category:'Kitchen & Dining',sourceText:'Kitchen & Dining'}],kitchenDiningConfirmation:'confirmed',signals:[],unavailableSignals:['demand','seasonality','growth'],products:[],dateColumns:[],representativeHistory:[]};
   const body=kind==='product_database'?product:kind==='category_trends'?category:{kind:'fixture'};
   const ciphertext=kind==='product_database'||kind==='category_trends'?encryptSecret(Buffer.from(JSON.stringify(body)),key,'browser-task-result:'+receiptId):'unused';
   await test.pool.query('INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids) VALUES($1,$2,$3,$4,ARRAY[]::uuid[])',[receiptId,taskId,exactPayloadHash(body),ciphertext]);
   await test.pool.query("UPDATE browser_tasks SET state='completed',result_id=$2 WHERE id=$1",[taskId,receiptId]);
  }
  return {id,query};
 }
 const complete=await candidate('complete');
 const ai={transport:{kind:'disabled'},encryptionKey:key};
 await advanceCandidate(test.pool,denyTransport(),{candidateId:complete.id,stage:'api_validation',inputVersion:1},ai);
 assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[complete.id])).rows[0].stage,'sourcing');
 const evidence=(await test.pool.query("SELECT field,kind,value_numeric::text,value_text,reason,source_id FROM evidence WHERE candidate_id=$1 AND field IN ('review_700_count','review_2000_count','monthly_revenue_competitors','top_price') ORDER BY field",[complete.id])).rows;
 assert.deepEqual(evidence.map(row=>[row.field,row.kind,row.value_numeric??row.value_text]),[
  ['monthly_revenue_competitors','estimate','5'],['review_2000_count','measured','0'],['review_700_count','measured','0'],['top_price','measured','25'],
 ]);
 assert.ok(evidence.every(row=>row.source_id.startsWith('browser-task-result:')));
 const partial=await candidate('partial','partial');
 await advanceCandidate(test.pool,denyTransport(),{candidateId:partial.id,stage:'api_validation',inputVersion:1},ai);
 assert.equal((await test.pool.query('SELECT stage,blocked_reason FROM candidates WHERE id=$1',[partial.id])).rows[0].blocked_reason,'evidence');
 const partialEvidence=(await test.pool.query("SELECT field,kind,reason FROM evidence WHERE candidate_id=$1 AND field IN ('review_700_count','review_2000_count','monthly_revenue_competitors','top_price') ORDER BY field",[partial.id])).rows;
 assert.ok(partialEvidence.every(row=>row.kind==='unknown'));
 console.log(JSON.stringify({scenario:'browser-canonical-validation',result:'PASS',completePopulationEvaluated:true,partialPopulationHeld:true,unknownsPreserved:true,encryptedReceiptBound:true,developerApiCalls:0,externalActions:0}));
}finally{await test.close();}
