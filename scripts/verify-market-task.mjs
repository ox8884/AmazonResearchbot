import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueAmazonSearch,queueAmazonPackage} from '../apps/worker/src/browser-task-producer.ts';
import {dispatchBrowserWork} from '../apps/worker/src/browser-dispatch.ts';
import {loadCanonicalNicheEvidence} from '../apps/worker/src/api-validation-store.ts';
import {createAsideAdapter} from '../apps/browser-bridge/aside-adapter.mjs';
import {decryptSecret} from '../packages/security/src/secrets.ts';
import {openBrowserTaskLedger} from '../apps/browser-bridge/task-ledger.mjs';
import {createRecoveryCycle} from '../apps/browser-bridge/recovery-cycle.mjs';

const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const address=reserve.address();assert.ok(address&&typeof address==='object');await new Promise(resolve=>reserve.close(resolve));
const origin='http://127.0.0.1:'+address.port,test=await openAcceptance({databaseKey:'market-task-'+Date.now(),webOrigin:origin});let adapter,directory,liveResult=null;
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const keys=browserSigningFixture(),identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey),signing={origin,privateKey:keys.privateKey};
 const pairing=await test.call('/api/bridge/pairings',{}),enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic market observer'});assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id;
 const call=async(url,body)=>{const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{origin,authorization:'Bearer '+enrolled.body.credential,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});return {status:response.status,body:await response.json()};};
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['amazon_search','amazon_package'],keyFingerprint:identity.fingerprint})).status,200);
 const candidate=async keyword=>(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[keyword])).rows[0].id;
 const query='synthetic market '+test.runId,id=await candidate(query),asin='B0QA000001';
 await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[id,JSON.stringify({representativeAsin:'B0QA000099'})]);
 const market=await queueAmazonSearch(test.pool,{deviceId,candidateId:id},signing),pack=await queueAmazonPackage(test.pool,{deviceId,candidateId:id},signing);
 assert.equal(market.kind,'queued');assert.equal(pack.kind,'queued');assert.notEqual(market.taskId,pack.taskId,'Market and package reads must not deduplicate each other');
 const claim=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(claim.taskId,market.taskId);
 const request=JSON.parse(Buffer.from(claim.envelope.payload,'base64url')).request;assert.equal(request.kind,'amazon_search');assert.equal(request.query,query);
 const item={position:1,asin,title:'Synthetic spatula',productUrl:'https://www.amazon.com/dp/'+asin,imageUrl:null,adStatus:'sponsored',priceTexts:['$8.99'],sourceText:'Synthetic spatula $8.99'};
 const observation={protocol:1,kind:'captured',scope:'amazon_search_first_page',query,marketplace:'us',sort:'featured',sourcePageUrl:'https://www.amazon.com/s?k='+encodeURIComponent(query),observedAt:new Date().toISOString(),rangeText:'1-1 of 20 results for "'+query+'"',rangeEnd:1,coverage:'complete',slots:[item,{...item,position:2,adStatus:'not_marked',priceTexts:['$8.99','$7.99'],sourceText:'Synthetic spatula $8.99 Coupon $7.99'}],snapshot:'Synthetic fixture'};
 const submit=value=>call('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation:value});
 assert.equal((await submit({...observation,sourcePageUrl:observation.sourcePageUrl+'&page=2'})).status,400);
 assert.equal((await submit({...observation,observedAt:'2020-01-01T00:00:00.000Z'})).status,409);
 await assert.rejects(test.pool.query("UPDATE browser_tasks SET task_kind='amazon_package' WHERE id=$1",[market.taskId]),'Task purpose must be immutable');
 const counts=async()=>(await test.pool.query('SELECT (SELECT count(*)::int FROM browser_task_results) AS receipts,(SELECT count(*)::int FROM pgboss.job) AS jobs,(SELECT count(*)::int FROM evidence) AS evidence')).rows[0];
 const before=await counts(),send=test.boss.send;test.boss.send=async(...args)=>{await send.apply(test.boss,args);throw Error('Synthetic enqueue failure');};
 try{assert.equal((await submit(observation)).status,500);}finally{test.boss.send=send;}
 assert.deepEqual(await counts(),before);assert.equal((await call('/api/bridge/tasks/'+market.taskId)).body.state,'delivered');
 const accepted=await submit(observation);assert.equal(accepted.status,201);
 const after=await counts(),duplicate=await submit(observation);assert.equal(duplicate.status,200);assert.deepEqual(await counts(),after);
 const stored=(await test.pool.query('SELECT body_ciphertext FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId)),observation);
 const visible=(await test.call('/api/candidates/'+id+'/market-source')).body;assert.equal(visible.state,'captured');assert.equal(visible.slots.length,2);assert.equal(visible.slots[1].price.kind,'unknown');assert.equal(visible.snapshot,undefined);assert.equal(visible.slots[0].sourceText,undefined);
 assert.equal((await loadCanonicalNicheEvidence(test.pool,id)).topPriceUsd.kind,'unknown','A displayed listing price is not a market leader price');
 const choices=(await test.call('/api/candidates/'+id+'/representative')).body;assert.ok(choices.availableAsins.includes(asin),'Current observed unmarked ASINs can be selected without fabricated API catalog facts');assert.equal(choices.titles[asin],item.title);
 assert.equal((await test.call('/api/candidates/'+id+'/representative',{asin,inputVersion:1})).status,200);
 assert.equal((await test.call('/api/candidates/'+id+'/market-source')).body.state,'stale');
 const updated=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(updated.kind,'idle','Old package context is cancelled after representative change');
 assert.equal((await dispatchBrowserWork(test.pool,{...signing,fingerprint:identity.fingerprint})).queued,2,'Both current package and market tasks remain eligible');
 await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE state IN ('queued','delivered')");
 await test.pool.query("UPDATE candidates SET stage='rejected' WHERE id=$1",[id]);
 const fairnessIds=[];
 for(let index=0;index<20;index++)fairnessIds.push(await candidate('synthetic fairness '+test.runId+' '+index));
 const fairnessDirectory=await mkdtemp(path.join(tmpdir(),'forge-fairness-'));
 const ledger=openBrowserTaskLedger({directory:fairnessDirectory,origin,deviceId,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString()});
 const reads=[];
 const cycle=createRecoveryCycle({deviceId,ledger,readCredential:async()=>enrolled.body.credential,
  client:{claimTask:async()=>(await call('/api/bridge/tasks/claim',{})).body,
   readTask:async value=>(await call('/api/bridge/tasks/'+value.taskId)).body,
   submitObservation:async value=>{const r=await call('/api/bridge/tasks/'+value.taskId+'/results',{taskHash:value.taskHash,observation:value.observation});assert.equal(r.status,201);return r.body;}},
  adapter:{collect:async envelope=>{const claimed=ledger.claim(envelope);if(claimed.kind!=='claimed')return claimed;
   const request=claimed.task.request;reads.push(request.candidateId);
   if(request.candidateId===fairnessIds[0])return {kind:'unavailable',taskId:claimed.taskId,taskHash:claimed.taskHash};
   return {kind:'captured',taskId:claimed.taskId,taskHash:claimed.taskHash,observation:{...observation,query:request.query,
    sourcePageUrl:'https://www.amazon.com/s?k='+encodeURIComponent(request.query),rangeText:'1-1 of 20 results for "'+request.query+'"',observedAt:new Date().toISOString()}};
  }}});
 try{
  const blocked=await queueAmazonSearch(test.pool,{deviceId,candidateId:fairnessIds[0]},signing);
  await queueAmazonSearch(test.pool,{deviceId,candidateId:fairnessIds[1]},signing);
  assert.equal((await cycle()).kind,'unavailable');
  assert.equal((await cycle()).kind,'completed','An unavailable read must not block another queued candidate');
  await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[blocked.taskId]);
  await queueAmazonSearch(test.pool,{deviceId,candidateId:fairnessIds[0]},signing);
  for(const candidateId of fairnessIds.slice(2))await queueAmazonSearch(test.pool,{deviceId,candidateId},signing);
  for(let index=2;index<20;index++)assert.equal((await cycle()).kind,'completed','Never-attempted candidates must precede a replacement for a failed read');
  assert.equal(new Set(reads).size,20);assert.equal(reads.filter(value=>value===fairnessIds[0]).length,1);
  assert.equal((await test.pool.query("SELECT count(*)::int n FROM browser_tasks WHERE candidate_id=ANY($1::uuid[]) AND state='completed'",[fairnessIds])).rows[0].n,19);
 }finally{
  ledger.close();assert.equal(path.dirname(path.resolve(fairnessDirectory)),path.resolve(tmpdir()));assert.ok(path.basename(fairnessDirectory).startsWith('forge-fairness-'));await rm(fairnessDirectory,{recursive:true,force:true});
  await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE candidate_id=ANY($1::uuid[]) AND state IN ('queued','delivered')",[fairnessIds]);
  await test.pool.query("UPDATE candidates SET stage='rejected' WHERE id=ANY($1::uuid[])",[fairnessIds]);
 }
 if(process.argv.includes('--live')){
  const liveId=await candidate('silicone spatula set'),queued=await queueAmazonSearch(test.pool,{deviceId,candidateId:liveId},signing);assert.equal(queued.kind,'queued');
  const liveClaim=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(liveClaim.taskId,queued.taskId);
  directory=await mkdtemp(path.join(tmpdir(),'forge-market-read-'));
  adapter=createAsideAdapter({directory,origin,deviceId,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT});
  const captured=await adapter.collect(liveClaim.envelope);assert.equal(captured.kind,'captured');
  assert.equal((await adapter.collect(liveClaim.envelope)).kind,'pending_reconciliation');
  const response=await call('/api/bridge/tasks/'+liveClaim.taskId+'/results',{taskHash:liveClaim.taskHash,observation:captured.observation});assert.equal(response.status,201);
  adapter.confirmServerReceipt({taskId:liveClaim.taskId,taskHash:liveClaim.taskHash,receiptId:response.body.receiptId});assert.equal((await adapter.collect(liveClaim.envelope)).kind,'completed');
  const view=(await test.call('/api/candidates/'+liveId+'/market-source')).body;assert.equal(view.state,'captured');assert.equal(view.slots.length,captured.observation.slots.length);
  assert.equal((await loadCanonicalNicheEvidence(test.pool,liveId)).topPriceUsd.kind,'unknown');
  liveResult={slots:view.slots.length,coverage:view.coverage,query:view.query,rawReceipt:true,corePriceUnknown:true};
  await writeFile('.omo/evidence/market-evidence/live-task.json',JSON.stringify({syntheticCandidate:true,actualBrowserSource:true,observation:captured.observation,liveResult},null,2));
 }
 console.log(JSON.stringify({scenario:'market-task',result:'PASS',realLocalHttp:true,purposeSeparated:true,atomicReceipt:true,duplicateReceipt:true,versionBound:true,representativeFromObservedAsin:true,corePriceNotInferred:true,liveResult,paidApiCalls:0}));
}finally{adapter?.close();await test.close();if(directory){assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('forge-market-read-'));await rm(directory,{recursive:true,force:true});}}
