import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {openAcceptance} from './support/acceptance.mjs';
import {auxiliaryFixture} from './support/auxiliary-fixture.mjs';
import {importCsv} from './support/import-csv.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {createSimulatorTransport, denyTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueAmazonSearch, queueAmazonPackage, queueSupplierSearch, queueSupplierDetail} from '../apps/worker/src/browser-task-producer.ts';
import {advanceCandidate} from '../apps/worker/src/advance-candidate.ts';
import {consumeOfficialValidation} from '../apps/worker/src/api-validation.ts';
import {prepareReadyRfqs} from '../apps/worker/src/automatic-rfq.ts';

const test=await openAcceptance({databaseKey:'unattended-flow-'+Date.now(), authSecret:'unattended-auth-secret-32-characters'});
const calls=[];
const catalog=new Map();
const leaders=new Set();
function productsFor(keyword){
 let seed=0;for(const ch of keyword)seed=(seed*33+ch.charCodeAt(0))>>>0;
 return Array.from({length:6},(_,i)=>{
  const asin='B0U'+String((seed+i*17)%10000000).padStart(7,'0');
  const leader=i===5;
  if(leader)leaders.add(asin);
  return {id:'us/'+asin,type:'product_database_result',attributes:{
   price:leader?29:25,reviews:120,category:'Kitchen & Dining',parent_asin:null,is_variant:false,is_parent:false,variants:[],
   approximate_30_day_units_sold:leader?500:300,approximate_30_day_revenue:leader?15000:9000,
   updated_at:new Date().toISOString(),
  }};
 });
}
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const text=Buffer.concat(chunks).toString(),body=text?JSON.parse(text):null;
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/api/product_database_query'){
  const keyword=body.data.attributes.include_keywords[0];
  const data=productsFor(keyword);
  data.forEach(row=>catalog.set(row.id.split('/')[1],{parent_asin:null,is_variant:false,is_parent:false,is_standalone:true,variants:[]}));
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data,links:{next:null}}));return;
 }
 const result=auxiliaryFixture(url,body);
 if(url.pathname==='/api/sales_estimates_query'){
  calls.push(Object.fromEntries(url.searchParams));
  const family=catalog.get(url.searchParams.get('asin'));
  if(family)Object.assign(result.data[0].attributes,family);
  const units=leaders.has(url.searchParams.get('asin'))?80:20;
  result.data[0].attributes.data.forEach(day=>{day.estimated_units_sold=units;});
 }
 assert.ok(result);res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const transport=createSimulatorTransport('http://127.0.0.1:'+server.address().port,'development');
const keys=browserSigningFixture();
try{
 const latest=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 const snapshot={...latest.snapshot,jsDailyWireCap:500,productDatabaseMaxPages:3};
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'unattended-fixture',$2::jsonb)",[latest.version+1,JSON.stringify(snapshot)]);
 const bytes=await readFile(new URL('../tests/fixtures/opportunity-finder-20.csv',import.meta.url));
 const imported=await importCsv(test,'opportunity-finder-20.csv',bytes);
 assert.equal(imported.status,200);assert.equal(imported.body.created,20);
 const list=(await test.call('/api/candidates')).body.candidates;
 assert.equal(list.length,20);
 const blocked=list[0];
 await test.pool.query("UPDATE candidates SET blocked_reason='web_session' WHERE id=$1",[blocked.id]);
 for(const candidate of list){
  if(candidate.id===blocked.id)continue;
  await advanceCandidate(test.pool,denyTransport(),{candidateId:candidate.id,stage:'imported',inputVersion:1});
 }
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM candidates WHERE stage='api_validation'")).rows[0].n,19);
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pairing=await test.call('/api/bridge/pairings',{});
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic unattended reader'});
 assert.equal(enrolled.status,201);
 const deviceCall=(path,body)=>test.call(path,body,{authorization:'Bearer '+enrolled.body.credential});
 async function advertise(tasks){
  assert.equal((await deviceCall('/api/bridge/capabilities',{connected:true,supportedTasks:tasks,keyFingerprint:identity.fingerprint})).status,200);
 }
 const signing={origin:'http://localhost:5173',privateKey:keys.privateKey,fingerprint:identity.fingerprint};
 const key=Buffer.from(test.encryptionKeyHex,'hex');
 const wanted={material:'steel',dimensions:'30 cm',packaging:'box',requirements:'sample inspection'};
 async function takeToRfq(target,tag){
  await advertise(['amazon_search']);
  const queued=await queueAmazonSearch(test.pool,{deviceId:enrolled.body.id,candidateId:target.id},signing);
  assert.equal(queued.kind,'queued');
  const marketClaim=(await deviceCall('/api/bridge/tasks/claim',{})).body;
  const request=JSON.parse(Buffer.from(marketClaim.envelope.payload,'base64url')).request;
  assert.equal(request.kind,'amazon_search');
  assert.equal(request.query,target.normalized_keyword);
  const catalogAsins=productsFor(target.keyword_display).map(row=>row.id.split('/')[1]);
  const query=request.query;
  const observation={protocol:1,kind:'captured',scope:'amazon_search_first_page',query,marketplace:'us',sort:'featured',
   sourcePageUrl:'https://www.amazon.com/s?k='+encodeURIComponent(query),observedAt:new Date().toISOString(),
   rangeText:'1-'+catalogAsins.length+' of 20 results for "'+query+'"',rangeEnd:catalogAsins.length,coverage:'complete',
   snapshot:'Synthetic unattended first page',
   slots:catalogAsins.map((asin,index)=>({position:index+1,asin,title:'Synthetic utensil '+index,productUrl:'https://www.amazon.com/dp/'+asin,imageUrl:null,adStatus:'not_marked',priceTexts:['$29.00'],sourceText:'Synthetic utensil '+index+' $29.00'}))};
  assert.equal((await deviceCall('/api/bridge/tasks/'+marketClaim.taskId+'/results',{taskHash:marketClaim.taskHash,observation})).status,201);
  await advanceCandidate(test.pool,transport,{candidateId:target.id,stage:'api_validation',inputVersion:target.input_version},{transport:{kind:'disabled'},encryptionKey:key});
  const selected=(await test.call('/api/candidates/'+target.id+'/representative')).body;
  assert.equal(selected.selectedAsin,catalogAsins[5]);
  await advertise(['amazon_package']);
  const queuedPackage=await queueAmazonPackage(test.pool,{deviceId:enrolled.body.id,candidateId:target.id},signing);
  assert.equal(queuedPackage.kind,'queued');
  const packageClaim=(await deviceCall('/api/bridge/tasks/claim',{})).body;
  const packageRequest=JSON.parse(Buffer.from(packageClaim.envelope.payload,'base64url')).request;
  assert.equal(packageRequest.kind,'amazon_package');assert.equal(packageRequest.asin,selected.selectedAsin);
  const rows=[{label:'ASIN',value:selected.selectedAsin},{label:'Package Dimensions',value:'10 x 4 x 2 inches; 1 pounds'}].map(row=>({...row,excerpt:row.label+' '+row.value}));
  const packageObservation={protocol:1,kind:'captured',scope:'amazon_product_page',asin:selected.selectedAsin,sourcePageUrl:'https://www.amazon.com/dp/'+selected.selectedAsin,observedAt:new Date().toISOString(),snapshot:'Synthetic unattended package',pageText:rows.map(row=>row.excerpt).join(String.fromCharCode(10)),rows};
  assert.equal((await deviceCall('/api/bridge/tasks/'+packageClaim.taskId+'/results',{taskHash:packageClaim.taskHash,observation:packageObservation})).status,201);
  await advanceCandidate(test.pool,transport,{candidateId:target.id,stage:'api_validation',inputVersion:target.input_version},{transport:{kind:'disabled'},encryptionKey:key});
  assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[target.id])).rows[0].stage,'sourcing');
  const spec=await test.call('/api/candidates/'+target.id+'/specs',{...wanted,requestedQuantity:300,source:'Unattended local spec from package dimensions'});
  assert.equal(spec.status,201);
  await advertise(['supplier_search']);
  const queuedSearch=await queueSupplierSearch(test.pool,{deviceId:enrolled.body.id,candidateId:target.id},signing);
  assert.equal(queuedSearch.kind,'queued');
  const searchClaim=(await deviceCall('/api/bridge/tasks/claim',{})).body;
  const searchRequest=JSON.parse(Buffer.from(searchClaim.envelope.payload,'base64url')).request;
  assert.equal(searchRequest.kind,'supplier_search');
  const records=[1,2].map(n=>({
   companyName:'Synthetic supplier '+tag+n,companyUrl:'https://synthetic'+tag+n+'.en.alibaba.com/',
   productName:'Synthetic product '+tag+n,productUrl:'https://www.alibaba.com/product-detail/Synthetic_'+tag+n+'2345.html',
   pageText:'Synthetic supplier '+tag+n+' Synthetic product '+tag+n,
  }));
  const searchObservation={protocol:1,kind:'captured',scope:'first_results_page',sourcePageUrl:'https://www.alibaba.com/search/page?SearchText='+encodeURIComponent(searchRequest.query),query:searchRequest.query,observedAt:new Date().toISOString(),snapshot:'Synthetic unattended search',visibleCards:2,records};
  const searchResult=await deviceCall('/api/bridge/tasks/'+searchClaim.taskId+'/results',{taskHash:searchClaim.taskHash,observation:searchObservation});
  assert.equal(searchResult.status,201);assert.equal(searchResult.body.captureIds.length,2);
  const nl=String.fromCharCode(10);
  for (const captureId of searchResult.body.captureIds) {
   await advertise(['supplier_detail']);
   const queuedDetail=await queueSupplierDetail(test.pool,{deviceId:enrolled.body.id,candidateId:target.id,sourceCaptureId:captureId},signing);
   assert.equal(queuedDetail.kind,'queued');
   const detailClaim=(await deviceCall('/api/bridge/tasks/claim',{})).body;
   const detailRequest=JSON.parse(Buffer.from(detailClaim.envelope.payload,'base64url')).request;
   assert.equal(detailRequest.kind,'supplier_detail');
   const n=detailRequest.companyUrl.includes(tag+'2')?2:1;
   const attributes=[['Material',wanted.material],['Product dimensions',wanted.dimensions],['Packaging',wanted.packaging],['Requirements',wanted.requirements],['Email','supplier'+tag+n+'@fixture.invalid']].map(([label,value])=>({label,value,excerpt:label+nl+value}));
   const detailObservation={protocol:1,kind:'captured',scope:'supplier_product_page',sourcePageUrl:detailRequest.productUrl,companyName:detailRequest.companyName,companyUrl:detailRequest.companyUrl,productName:'Synthetic product '+tag+n,observedAt:new Date().toISOString(),snapshot:'Synthetic unattended listing',pageText:['Synthetic product '+tag+n,detailRequest.companyName,...attributes.map(x=>x.excerpt)].join(nl),attributes};
   assert.equal((await deviceCall('/api/bridge/tasks/'+detailClaim.taskId+'/results',{taskHash:detailClaim.taskHash,observation:detailObservation})).status,201);
  }
  return target.id;
 }
 const firstAdvance=calls.length;
 const targets=(await test.pool.query("SELECT id,keyword_display,normalized_keyword,input_version FROM candidates WHERE stage='api_validation' ORDER BY last_progress_at,id LIMIT 2")).rows;
 assert.equal(targets.length,2);
 const firstId=await takeToRfq(targets[0],'a');
 const secondId=await takeToRfq(targets[1],'b');
 await prepareReadyRfqs(test.pool);
 for(const id of [firstId,secondId]){
  const contact=(await test.call('/api/candidates/'+id+'/contact')).body;
  assert.equal(contact.drafts.length,2);
  assert.ok(contact.drafts.every(d=>d.state==='pending_approval'));
  assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[id])).rows[0].stage,'awaiting_contact_approval');
 }
 const beforeRepeat=(await test.call('/api/candidates/'+firstId+'/contact')).body.drafts.map(d=>d.id).sort();
 await prepareReadyRfqs(test.pool);
 assert.deepEqual((await test.call('/api/candidates/'+firstId+'/contact')).body.drafts.map(d=>d.id).sort(),beforeRepeat);
 const cachedCalls=calls.length;
 const current=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 assert.equal(await consumeOfficialValidation(test.pool,transport,{candidateId:firstId,keyword:targets[0].keyword_display,inputVersion:targets[0].input_version,settingsVersion:current.version,snapshot:current.snapshot,accountScope:'unattended-retry'}),'stale');
 assert.equal(calls.length,cachedCalls);
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM candidates WHERE id=$1 AND blocked_reason='web_session'",[blocked.id])).rows[0].n,1);
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM rfq_drafts WHERE state=$1',['pending_approval'])).rows[0].n,4);
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM external_actions')).rows[0].n,0);
 assert.ok(calls.length-firstAdvance>0);
 console.log(JSON.stringify({scenario:'unattended-flow',result:'PASS',imported:20,independentHold:true,pipedCandidates:2,rfqPending:4,noResend:true,cacheReuse:true,externalActions:0,realProviderCalls:0}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await test.close();}
