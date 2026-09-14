import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueCategoryTrends,queueCompetitiveIntelligence,queueHistoricalData,queueKeywordScout,queueProductDatabase} from '../apps/worker/src/browser-task-producer.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';
import {competitiveIntelligenceObservationSchema} from '../packages/domain/src/competitive-intelligence.ts';
import vm from 'node:vm';
import {competitiveIntelligenceScript} from '../apps/browser-bridge/aside-competitive-intelligence-script.mjs';

// Given the CI page is upgrade-gated, When the generated observer falls back to Product Database,
// Then the captured result preserves the gate and chooses a representative only from a unique revenue leader.
const gateText='Competitive Intelligence Accelerate revenue growth Upgrade to Brand Owner';
const rowCells=['','B0CI000001 Synthetic ice cream scoop kitchen tool','Synthetic Brand','Home & Kitchen > Kitchen & Dining','1,234','450','$11,250','$25.00','120','4.6','3','','','10 x 6 x 4 in','2.2 lb'];
const fakeRow={getClientRects:()=>[{}],innerText:rowCells.join(' '),querySelectorAll:()=>rowCells.map(innerText=>({innerText}))};
const tieCells=['','B0CI000002 Synthetic ice cream scoop kitchen tool','Synthetic Brand 2','Home & Kitchen > Kitchen & Dining','1,235','500','$11,250','$27.00','140','4.5','4','','','11 x 6 x 4 in','2.4 lb'];
const tieRow={getClientRects:()=>[{}],innerText:tieCells.join(' '),querySelectorAll:()=>tieCells.map(innerText=>({innerText}))};
let tableRows=[fakeRow];
let currentUrl='https://members.junglescout.com/#/competitive-intelligence';
let homeKitchen=true,standard=true,resultLimit='50';
const fakeInput={value:'',waitFor:async()=>{},fill:async value=>{fakeInput.value=value;},evaluate:async callback=>callback({value:fakeInput.value})};
const fakeLabel=name=>({first(){return this;},waitFor:async()=>{},click:async()=>{if(name==='Home & Kitchen')homeKitchen=true;if(name==='Standard')standard=true;},evaluate:async callback=>callback({matches:()=>false,querySelector:()=>({checked:name==='Home & Kitchen'?homeKitchen:standard,getAttribute:()=>null}),parentElement:null})});
const fakeLimit={evaluate:async callback=>callback({innerText:resultLimit,parentElement:{parentElement:{innerText:`Displaying 100 of ${tableRows.length}`}}}),click:async()=>{},waitFor:async()=>{}};
const fakePage={
 goto:async url=>{currentUrl=url;},
 evaluate:async()=>currentUrl,
 locator:selector=>selector==='body'?{waitFor:async()=>{},evaluate:async callback=>callback({innerText:gateText})}:selector==='[role="combobox"]'?{evaluateAll:async()=>true}:selector==='[data-testid="multi-select-trigger"]'?{evaluateAll:async()=>0,nth:index=>{assert.equal(index,0);return fakeLimit;}}:{},
 getByText:name=>fakeLabel(name),
 getByRole:(role,options={})=>{
  if(role==='textbox')return {first:()=>fakeInput};
  if(role==='option'){assert.equal(options.name,'100');return {click:async()=>{resultLimit='100';}};}
  if(role==='button')return {waitFor:async()=>{},click:async()=>{}};
  if(role==='table')return {waitFor:async()=>{},evaluate:async callback=>callback({querySelectorAll:()=>[{},...tableRows]})};
  throw new Error('Unexpected role '+role+' '+JSON.stringify(options));
 },
};
const generatedOutput=[];
await vm.runInNewContext('(async()=>{'+competitiveIntelligenceScript('ice cream scoop','CI:')+'})()',{
 console:{log:value=>generatedOutput.push(value)},
 listBrowserTabs:async()=>[{targetId:'existing-jungle-scout',url:'https://members.junglescout.com/#/dashboard'}],
 attachBrowserTab:async targetId=>{assert.equal(targetId,'existing-jungle-scout');return fakePage;},
 openTab:async()=>{throw new Error('Existing authenticated tab must be reused');},
 closeTab:async()=>{throw new Error('User tab must not be closed');},
 snapshot:async()=>({tree:'Synthetic Product Database table'}),
 getComputedStyle:()=>({visibility:'visible'}),
 document:{body:{}},
 },{timeout:1000});
assert.equal(generatedOutput.length,1);
const generatedResult=JSON.parse(generatedOutput[0].slice('CI:'.length));
assert.equal(generatedResult.kind,'captured');
assert.equal(generatedResult.entitlement.status,'upgrade_required');
assert.equal(generatedResult.entitlement.currentPlan,null);
assert.equal(generatedResult.entitlement.requiredPlan,'Brand Owner');
assert.equal(generatedResult.competitors.length,1);
assert.equal(generatedResult.displayedCount,1);
assert.equal(generatedResult.totalCount,1);
assert.equal(generatedResult.coverage,'complete');
assert.equal(generatedResult.representativeAsin,'B0CI000001');
assert.equal(generatedResult.sourcePageUrl,'https://members.junglescout.com/#/database');
assert.equal(competitiveIntelligenceObservationSchema.safeParse(generatedResult).success,true);
tableRows=[fakeRow,tieRow];
generatedOutput.length=0;
await vm.runInNewContext('(async()=>{'+competitiveIntelligenceScript('ice cream scoop','CI:')+'})()',{
 console:{log:value=>generatedOutput.push(value)},listBrowserTabs:async()=>[{targetId:'existing-jungle-scout',url:'https://members.junglescout.com/#/dashboard'}],
 attachBrowserTab:async()=>fakePage,openTab:async()=>{throw new Error('Existing authenticated tab must be reused');},closeTab:async()=>{throw new Error('User tab must not be closed');},snapshot:async()=>({tree:'Synthetic Product Database table'}),getComputedStyle:()=>({visibility:'visible'}),
 document:{body:{}},
},{timeout:1000});
const tiedResult=JSON.parse(generatedOutput[0].slice('CI:'.length));
assert.equal(tiedResult.representativeAsin,null,'A tied Product Database leader remains unselected');
assert.equal(tiedResult.representativeSelection,'ambiguous_revenue_leader');
const emptyUpgradeFallback={...generatedResult,representativeAsin:null,representativeSelection:'insufficient_revenue_data',displayedCount:0,totalCount:0,coverage:'complete',competitors:[]};
assert.equal(competitiveIntelligenceObservationSchema.safeParse(emptyUpgradeFallback).success,true,'An upgrade-gated fallback may retain an empty Product Database comparison');
assert.equal(competitiveIntelligenceObservationSchema.safeParse({...generatedResult,representativeAsin:null}).success,false,'A unique leader cannot omit its observed representative ASIN');

const reserve=createServer();
reserve.listen(0,'127.0.0.1');
await once(reserve,'listening');
const address=reserve.address();
assert.ok(address&&typeof address==='object');
await new Promise(resolve=>reserve.close(resolve));

const origin='http://127.0.0.1:'+address.port;
const test=await openAcceptance({databaseKey:'competitive-intelligence-task-'+Date.now(),webOrigin:origin});
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const keys=browserSigningFixture();
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pairing=await test.call('/api/bridge/pairings',{});
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic Competitive Intelligence observer'});
 assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id;
 const call=async(url,body)=>{
  const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{origin,authorization:'Bearer '+enrolled.body.credential,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10_000)});
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['product_database','keyword_scout','historical_data','category_trends','competitive_intelligence'],keyFingerprint:identity.fingerprint})).status,200);
 const query='synthetic competitive intelligence '+test.runId;
 await test.pool.query("UPDATE settings_versions SET snapshot=jsonb_set(snapshot,'{jsDailyWireCap}','20'::jsonb) WHERE version=(SELECT max(version) FROM settings_versions)");
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[query])).rows[0];
 const prerequisiteObservations=[
  {queue:queueProductDatabase,kind:'product_database',value:{protocol:1,kind:'captured',scope:'jungle_scout_product_database',query,marketplace:'us',category:'Kitchen & Dining',discoveryCategory:'Home & Kitchen',productTier:'Standard',resultLimit:100,sourcePageUrl:'https://members.junglescout.com/#/database',observedAt:new Date().toISOString(),snapshot:'Synthetic prerequisite product',records:[{asin:'B0CI000001',title:'Synthetic kitchen tool',sourceText:'B0CI000001 Synthetic kitchen tool'}]}},
  {queue:queueKeywordScout,kind:'keyword_scout',value:{protocol:1,kind:'captured',scope:'jungle_scout_keyword_scout',query,sourcePageUrl:'https://members.junglescout.com/#/keyword',observedAt:new Date().toISOString(),snapshot:'Synthetic prerequisite keyword',metrics:[],relatedKeywords:[],asinRelations:[],keywordRecords:[]}},
  {queue:queueHistoricalData,kind:'historical_data',value:{protocol:1,kind:'captured',scope:'jungle_scout_historical_data',query,sourcePageUrl:'https://members.junglescout.com/#/keyword',observedAt:new Date().toISOString(),snapshot:'Synthetic prerequisite history',dateRange:null,series:[]}},
  {queue:queueCategoryTrends,kind:'category_trends',value:{protocol:1,kind:'captured',scope:'jungle_scout_category_trends',query,sourcePageUrl:'https://members.junglescout.com/#/category-trends',observedAt:new Date().toISOString(),snapshot:'Synthetic prerequisite category',categories:[],kitchenDiningConfirmation:'not_confirmed',signals:[]}},
 ];
 for(const prerequisite of prerequisiteObservations){
  const prerequisiteQueued=await prerequisite.queue(test.pool,{deviceId,candidateId:candidate.id},{origin,privateKey:keys.privateKey});
  assert.equal(prerequisiteQueued.kind,'queued');
  const prerequisiteClaim=(await call('/api/bridge/tasks/claim',{})).body;
  assert.equal(prerequisiteClaim.kind,'task',JSON.stringify(prerequisiteClaim));
  const prerequisiteRequest=JSON.parse(Buffer.from(prerequisiteClaim.envelope.payload,'base64url')).request;
  assert.equal(prerequisiteRequest.kind,prerequisite.kind);
  const prerequisiteObservation={...prerequisite.value,observedAt:new Date().toISOString()};
  const prerequisiteAccepted=await call('/api/bridge/tasks/'+prerequisiteClaim.taskId+'/results',{taskHash:prerequisiteClaim.taskHash,observation:prerequisiteObservation});
  assert.equal(prerequisiteAccepted.status,201,prerequisite.kind+': '+JSON.stringify(prerequisiteAccepted.body));
 }
 const queued=await queueCompetitiveIntelligence(test.pool,{deviceId,candidateId:candidate.id},{origin,privateKey:keys.privateKey});
 assert.equal(queued.kind,'queued');
 const claim=(await call('/api/bridge/tasks/claim',{})).body;
 assert.equal(claim.taskId,queued.taskId);
 const request=JSON.parse(Buffer.from(claim.envelope.payload,'base64url')).request;
 assert.equal(request.kind,'competitive_intelligence');
 assert.equal(request.query,query);
 const observation={protocol:1,kind:'captured',scope:'jungle_scout_competitive_intelligence',query,sourcePageUrl:'https://members.junglescout.com/#/database',observedAt:new Date().toISOString(),snapshot:'Synthetic Competitive Intelligence result',representativeAsin:'B0CI000001',representativeSelection:'unique_revenue_leader',comparisonBasis:'product_database',displayedCount:1,totalCount:1,coverage:'complete',entitlement:{status:'upgrade_required',currentPlan:'$470/yr',requiredPlan:'$1,548/yr',sourcePageUrl:'https://members.junglescout.com/#/competitive-intelligence',sourceText:'Access Competitive Intelligence and more by upgrading now Your Plan $470/yr Brand Owner Plan $1,548/yr'},competitors:[{asin:'B0CI000001',brand:'Synthetic Brand',price:'$25.00',reviews:'120',sales:'450',revenue:'$11,250',sourceText:'B0CI000001 Synthetic Brand $25.00 120 450 $11,250'}]};
 const submit=value=>call('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation:value});
 const accepted=await submit(observation);
 assert.equal(accepted.status,201);
 const duplicate=await submit(observation);
 assert.equal(duplicate.status,200);
 const stored=(await test.pool.query('SELECT body_ciphertext,capture_ids FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(stored.capture_ids,[],'Competitive Intelligence observations retain explicit browser provenance only');
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId)),observation);
 const unobservedRepresentative={...observation,representativeAsin:'B0CI000002'};
 assert.equal(competitiveIntelligenceObservationSchema.safeParse(unobservedRepresentative).success,false,'Representative ASIN cannot be inferred from an unobserved competitor');
 console.log(JSON.stringify({scenario:'signed_competitive_intelligence_aside_task',result:'PASS',signedTask:true,claimed:true,encryptedReceipt:true,duplicateReceipt:true,unobservedRepresentativeRejected:true,paidApiCalls:0,externalActions:0}));
}finally{await test.close();}
