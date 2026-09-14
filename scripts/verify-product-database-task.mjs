import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueProductDatabase} from '../apps/worker/src/browser-task-producer.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';
import {productDatabaseObservationSchema} from '../packages/domain/src/product-database.ts';
import {confirmsKitchenDining,selectBrowserProductLeader} from '../packages/domain/src/product-database-leader.ts';
import {INITIAL_SETTINGS} from '../packages/domain/src/settings.ts';

// Given a screen row with all displayed product fields and an unavailable weight.
const productRecord={asin:'B0PD000001',title:'Synthetic kitchen organizer',brand:'Synthetic Brand',categoryPath:'Kitchen & Dining > Storage',bsr:'1,234',unitsSoldMonthly:'450',revenueMonthly:'$11,250',price:'$25.00',reviews:'120',starRating:'4.6',sellers:'3',dimensions:'10 x 6 x 4 in',weight:null,sourceText:'B0PD000001 Synthetic kitchen organizer Synthetic Brand Kitchen & Dining > Storage 1,234 450 $11,250 $25.00 120 4.6 3 10 x 6 x 4 in'};
const productFixture={protocol:1,kind:'captured',scope:'jungle_scout_product_database',query:'synthetic',marketplace:'us',category:'Kitchen & Dining',discoveryCategory:'Home & Kitchen',productTier:'Standard',resultLimit:100,sourcePageUrl:'https://members.junglescout.com/#/database',observedAt:'2026-09-14T00:00:00.000Z',snapshot:productRecord.sourceText,records:[productRecord]};
// When parsing screen-backed fields, then values and unknowns are preserved.
assert.deepEqual(productDatabaseObservationSchema.parse(productFixture),productFixture);
for(const field of ['brand','categoryPath','bsr','unitsSoldMonthly','revenueMonthly','price','reviews','starRating','sellers','dimensions','weight']){
 assert.equal(productDatabaseObservationSchema.safeParse({...productFixture,records:[{...productRecord,[field]:'UNOBSERVED_VALUE'}]}).success,false,field+' must be present in its row source');
}
const legacyRecord={asin:productRecord.asin,title:productRecord.title,sourceText:productRecord.sourceText};
assert.deepEqual(productDatabaseObservationSchema.parse({...productFixture,records:[legacyRecord]}).records,[legacyRecord],'Legacy observations retain their exact payload shape');
assert.deepEqual(selectBrowserProductLeader(productFixture),{kind:'selected',asin:productRecord.asin,revenueText:productRecord.revenueMonthly},'A unique observed revenue leader selects its ASIN');
assert.equal(selectBrowserProductLeader({...productFixture,records:[productRecord,{...productRecord,asin:'B0PD000002'}]}).kind,'pending','A revenue tie stays pending');
assert.equal(selectBrowserProductLeader({...productFixture,records:[{...productRecord,revenueMonthly:null}]}).kind,'pending','An unknown revenue stays pending');
assert.deepEqual(selectBrowserProductLeader({...productFixture,records:[{...productRecord,revenueMonthly:'$11,250 / $5,625'}]}),{kind:'pending',reason:'MONTHLY_REVENUE_AMBIGUOUS'},'Mixed revenue strings stay pending');
assert.deepEqual(selectBrowserProductLeader({...productFixture,records:[{...productRecord,categoryPath:'Home & Kitchen'}]}),{kind:'pending',reason:'CATEGORY_UNCONFIRMED'},'Unconfirmed category membership stays pending');
assert.equal(confirmsKitchenDining('Kitchen & Dining Accessories'),false,'A similarly named category is not Kitchen & Dining');

const reserve=createServer();
reserve.listen(0,'127.0.0.1');
await once(reserve,'listening');
const address=reserve.address();
assert.ok(address&&typeof address==='object');
await new Promise(resolve=>reserve.close(resolve));

const origin='http://127.0.0.1:'+address.port;
const test=await openAcceptance({databaseKey:'product-database-task-'+Date.now(),webOrigin:origin});
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const keys=browserSigningFixture();
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'product-database-fixture',snapshot || '{\"jsDailyWireCap\":20}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1");
 const pairing=await test.call('/api/bridge/pairings',{});
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic Product Database observer'});
 assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id;
 const call=async(url,body)=>{
  const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{origin,authorization:'Bearer '+enrolled.body.credential,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10_000)});
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['product_database'],keyFingerprint:identity.fingerprint})).status,200);
 const currentSettings=Number((await test.pool.query('SELECT max(version)::int AS version FROM settings_versions')).rows[0].version);
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'product-database-task-fixture',$2::jsonb)",[currentSettings+1,JSON.stringify({...INITIAL_SETTINGS,jsDailyWireCap:10})]);
 const query='synthetic product database '+test.runId;
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[query])).rows[0];
 const queued=await queueProductDatabase(test.pool,{deviceId,candidateId:candidate.id},{origin,privateKey:keys.privateKey});
 assert.equal(queued.kind,'queued');
 const concurrentClaims=await Promise.all([
  call('/api/bridge/tasks/claim',{}),
  call('/api/bridge/tasks/claim',{}),
 ]);
 const taskClaims=concurrentClaims.filter(response=>response.body.kind==='task');
 assert.equal(taskClaims.length,1,'Concurrent bridge claims must deliver a queued task once');
 assert.equal(concurrentClaims.filter(response=>response.body.kind==='idle').length,1,'The losing concurrent claim must be idle');
 const claim=taskClaims[0].body;
 assert.equal(claim.taskId,queued.taskId);
 const request=JSON.parse(Buffer.from(claim.envelope.payload,'base64url')).request;
 assert.deepEqual(request.kind,'product_database');
 assert.equal(request.query,query);
 assert.equal(request.marketplace,'us');
 assert.equal(request.category,'Kitchen & Dining');
 assert.equal(request.discoveryCategory,'Home & Kitchen');
 assert.equal(request.productTier,'Standard');
 assert.equal(request.resultLimit,100);
 const observation={...productFixture,query,observedAt:new Date().toISOString()};
 const submit=value=>call('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation:value});
 const accepted=await submit(observation);
 assert.equal(accepted.status,201);
 const duplicate=await submit(observation);
 assert.equal(duplicate.status,200);
 const stored=(await test.pool.query('SELECT body_ciphertext,capture_ids FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(stored.capture_ids,[],'Product Database display observations do not fabricate API evidence');
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId)),observation);
 const selected=(await test.pool.query("SELECT detail FROM candidate_events WHERE candidate_id=$1 AND stage='api_validation' AND input_version=1",[candidate.id])).rows[0];
 assert.equal(selected?.detail?.representativeAsin,productRecord.asin,'Unique browser leader is recorded as the representative ASIN');
 assert.equal(selected?.detail?.selectionMethod,'browser_product_database_revenue','Selection records its screen-backed method');
 const representativeView=await test.call('/api/candidates/'+candidate.id+'/representative');
 assert.equal(representativeView.status,200);
 assert.equal(representativeView.body.availableAsins.includes(productRecord.asin),true,'Observed Kitchen & Dining Product Database ASINs are available for manual selection');
 assert.equal(representativeView.body.titles[productRecord.asin],productRecord.title);
 const manualQuery='manual '+query;
 const manualCandidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[manualQuery])).rows[0];
 await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[manualCandidate.id,JSON.stringify({representativeAsin:'B0PD000099',actor:'fixture-manual-selection'})]);
 const manualTask=await queueProductDatabase(test.pool,{deviceId,candidateId:manualCandidate.id},{origin,privateKey:keys.privateKey});
 assert.equal(manualTask.kind,'queued');
 const manualClaim=(await call('/api/bridge/tasks/claim',{})).body;
 assert.equal(manualClaim.taskId,manualTask.taskId);
 const manualObservation={...observation,query:manualQuery,observedAt:new Date().toISOString()};
 const manualAccepted=await call('/api/bridge/tasks/'+manualTask.taskId+'/results',{taskHash:manualClaim.taskHash,observation:manualObservation});
 assert.equal(manualAccepted.status,201);
 const manualSelection=(await test.pool.query("SELECT detail FROM candidate_events WHERE candidate_id=$1 AND stage='api_validation' AND input_version=1",[manualCandidate.id])).rows[0];
 assert.equal(manualSelection?.detail?.representativeAsin,'B0PD000099','A manual representative survives browser result acceptance');
 const stale=await submit({...observation,observedAt:'2020-01-01T00:00:00.000Z'});
 assert.equal(stale.status,409);
 console.log(JSON.stringify({scenario:'signed_product_database_aside_task',result:'PASS',signedTask:true,claimed:true,encryptedReceipt:true,duplicateReceipt:true,staleRejected:true,paidApiCalls:0,externalActions:0}));
}finally{await test.close();}
