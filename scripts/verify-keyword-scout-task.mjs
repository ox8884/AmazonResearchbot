import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueKeywordScout,queueProductDatabase} from '../apps/worker/src/browser-task-producer.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';
import {keywordScoutObservationSchema} from '../packages/domain/src/keyword-scout.ts';

// Given a Keyword Scout result row with an unavailable broad bid.
const keywordRecord={keyword:'synthetic kitchen organizer',searchTrend30Day:'-12%',exactSearchVolume30Day:'2,400',category:'Kitchen & Dining',ppcBidExact:'$0.75',ppcBidBroad:null,easeToRank:'Easy',relevancyScore:'87',sourceText:'synthetic kitchen organizer -12% 2,400 Kitchen & Dining $0.75 Easy 87'};
const keywordFixture={protocol:1,kind:'captured',scope:'jungle_scout_keyword_scout',query:'synthetic',sourcePageUrl:'https://members.junglescout.com/#/keyword',observedAt:'2026-09-14T00:00:00.000Z',snapshot:keywordRecord.sourceText,metrics:[],relatedKeywords:[],asinRelations:[],keywordRecords:[keywordRecord]};
// When parsing normalized rows, then source-backed strings and nulls survive.
assert.deepEqual(keywordScoutObservationSchema.parse(keywordFixture),keywordFixture);
for(const field of ['keyword','searchTrend30Day','exactSearchVolume30Day','category','ppcBidExact','ppcBidBroad','easeToRank','relevancyScore']){
 assert.equal(keywordScoutObservationSchema.safeParse({...keywordFixture,keywordRecords:[{...keywordRecord,[field]:'UNOBSERVED_VALUE'}]}).success,false,field+' must be present in its row source');
}
const {keywordRecords: omittedRecords,...legacyFixture}=keywordFixture;
assert.deepEqual(keywordScoutObservationSchema.parse(legacyFixture),legacyFixture,'Legacy observations retain their exact payload shape');

const reserve=createServer();
reserve.listen(0,'127.0.0.1');
await once(reserve,'listening');
const address=reserve.address();
assert.ok(address&&typeof address==='object');
await new Promise(resolve=>reserve.close(resolve));

const origin='http://127.0.0.1:'+address.port;
const test=await openAcceptance({databaseKey:'keyword-scout-task-'+Date.now(),webOrigin:origin});
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const keys=browserSigningFixture();
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pairing=await test.call('/api/bridge/pairings',{});
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic Keyword Scout observer'});
 assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id;
 const call=async(url,body)=>{
  const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{origin,authorization:'Bearer '+enrolled.body.credential,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10_000)});
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['product_database','keyword_scout'],keyFingerprint:identity.fingerprint})).status,200);
 await test.pool.query("UPDATE settings_versions SET snapshot=jsonb_set(snapshot,'{jsDailyWireCap}','20'::jsonb) WHERE version=(SELECT max(version) FROM settings_versions)");
 const query='synthetic keyword scout '+test.runId;
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[query])).rows[0];
 const productTask=await queueProductDatabase(test.pool,{deviceId,candidateId:candidate.id},{origin,privateKey:keys.privateKey});
 assert.equal(productTask.kind,'queued');
 const productClaim=(await call('/api/bridge/tasks/claim',{})).body;
 const productObservation={protocol:1,kind:'captured',scope:'jungle_scout_product_database',query,marketplace:'us',category:'Kitchen & Dining',discoveryCategory:'Home & Kitchen',productTier:'Standard',resultLimit:100,sourcePageUrl:'https://members.junglescout.com/#/database',observedAt:new Date().toISOString(),snapshot:'Synthetic prerequisite product',records:[{asin:'B0KS000001',title:'Synthetic kitchen organizer',sourceText:'B0KS000001 Synthetic kitchen organizer'}]};
 assert.equal((await call('/api/bridge/tasks/'+productClaim.taskId+'/results',{taskHash:productClaim.taskHash,observation:productObservation})).status,201);
 const queued=await queueKeywordScout(test.pool,{deviceId,candidateId:candidate.id},{origin,privateKey:keys.privateKey});
 assert.equal(queued.kind,'queued');
 const claim=(await call('/api/bridge/tasks/claim',{})).body;
 assert.equal(claim.taskId,queued.taskId);
 const request=JSON.parse(Buffer.from(claim.envelope.payload,'base64url')).request;
 assert.equal(request.kind,'keyword_scout');
 assert.equal(request.query,query);
 const observation={...keywordFixture,query,observedAt:new Date().toISOString(),metrics:[{label:'Search Volume',value:'2,400',sourceText:'Search Volume 2,400'}],relatedKeywords:[{keyword:'synthetic kitchen organizer',sourceText:'Related keyword synthetic kitchen organizer'}],asinRelations:[{asin:'B0KS000001',sourceText:'B0KS000001 keyword relation'}]};
 const submit=value=>call('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation:value});
 const accepted=await submit(observation);
 assert.equal(accepted.status,201);
 const duplicate=await submit(observation);
 assert.equal(duplicate.status,200);
 const stored=(await test.pool.query('SELECT body_ciphertext,capture_ids FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(stored.capture_ids,[],'Keyword Scout display observations do not fabricate API evidence');
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId)),observation);
 const stale=await submit({...observation,observedAt:'2020-01-01T00:00:00.000Z'});
 assert.equal(stale.status,409);
 console.log(JSON.stringify({scenario:'signed_keyword_scout_aside_task',result:'PASS',signedTask:true,claimed:true,encryptedReceipt:true,duplicateReceipt:true,staleRejected:true,paidApiCalls:0,externalActions:0}));
}finally{await test.close();}
