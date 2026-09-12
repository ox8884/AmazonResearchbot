import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAsideAdapter} from '../apps/browser-bridge/aside-adapter.mjs';
import {createBridgeClient} from '../apps/browser-bridge/enrollment.mjs';
import {deviceVault} from '../apps/browser-bridge/device-vault.mjs';
import {openBrowserTaskLedger} from '../apps/browser-bridge/task-ledger.mjs';
import {createRecoveryCycle} from '../apps/browser-bridge/recovery-cycle.mjs';
import {decryptSecret} from '../packages/security/src/secrets.ts';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {signBrowserTask} from '../apps/worker/src/browser-task-signer.ts';
import * as producer from '../apps/worker/src/browser-task-producer.ts';
import {prepareAutomaticRfqs} from '../apps/worker/src/automatic-rfq.ts';
const portHolder=createServer();portHolder.listen(0,'127.0.0.1');await once(portHolder,'listening');
const address=portHolder.address();assert.ok(address&&typeof address==='object');await new Promise(resolve=>portHolder.close(resolve));
const origin='http://127.0.0.1:'+address.port;
const test=await openAcceptance({databaseKey:'supplier-detail-acceptance',webOrigin:origin});
const keys=browserSigningFixture();let credential,adapter,directory,deviceId,vaultStored=false;
const live=process.argv.includes('--live');
const call=async(path,body)=>{
 const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,...(credential?{authorization:'Bearer '+credential}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});
 return {status:r.status,body:await r.json()};
};
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const issued=await test.call('/api/bridge/pairings',{});assert.equal(issued.status,201);
 const enrolled=await call('/api/bridge/pair',{pairingCode:issued.body.pairingCode,name:'Synthetic detail device'});assert.equal(enrolled.status,201);credential=enrolled.body.credential;
 deviceId=enrolled.body.id;
 await deviceVault('create',{origin,deviceId,credential});vaultStored=true;
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['supplier_search','supplier_detail'],keyFingerprint:identity.fingerprint})).status,200,'A detail-capable device must negotiate the new read task');
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id,input_version",['Synthetic detail '+test.runId])).rows[0];
 const version=(await test.call('/api/settings')).body.version;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[candidate.id,version,JSON.stringify({synthetic:true,inputVersion:1})]);
 const wanted={material:'steel',dimensions:'30 cm',packaging:'box',requirements:'sample inspection'};
 const spec=(await test.call('/api/candidates/'+candidate.id+'/specs',{...wanted,requestedQuantity:300,source:'Synthetic detail fixture'})).body;
 const signing={origin,privateKey:keys.privateKey};
 const search=await producer.queueSupplierSearch(test.pool,{deviceId,candidateId:candidate.id},signing);assert.equal(search.kind,'queued');
 const searchClaim=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(searchClaim.taskId,search.taskId);
 const prior=live?JSON.parse(await readFile(new URL('../.omo/evidence/supplier-detail/observed-layout.json',import.meta.url),'utf8')):null;
 const query='Synthetic detail '+test.runId,productUrl=prior?.sourcePageUrl??'https://www.alibaba.com/product-detail/Synthetic_12345.html',companyUrl=prior?.companyLinks[0].url??'https://synthetic.en.alibaba.com/';
 const companyName=prior?.companyLinks[0].text??'Synthetic supplier',productName=prior?.productName??'Synthetic product';
 const searchObservation={protocol:1,kind:'captured',scope:'first_results_page',sourcePageUrl:'https://www.alibaba.com/search/page?SearchText='+encodeURIComponent(query),query,observedAt:new Date().toISOString(),snapshot:'Synthetic search source',visibleCards:1,records:[{companyName,companyUrl,productName,productUrl,pageText:companyName+' '+productName}]};
 const searchResult=await call('/api/bridge/tasks/'+search.taskId+'/results',{taskHash:searchClaim.taskHash,observation:searchObservation});assert.equal(searchResult.status,201);
 const sourceCaptureId=searchResult.body.captureIds[0];
 const detail=await producer.queueSupplierDetail(test.pool,{deviceId,candidateId:candidate.id,sourceCaptureId},signing);assert.equal(detail.kind,'queued','Completed search must permit a separate source-bound detail task');
 const detailClaim=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(detailClaim.taskId,detail.taskId);
 const nl=String.fromCharCode(10);
 const attributes=[['Material',wanted.material],['Product dimensions',wanted.dimensions],['Packaging',wanted.packaging],['Requirements',wanted.requirements],['Email','supplier@fixture.invalid']].map(([label,value])=>({label,value,excerpt:label+nl+value}));
 let observation={protocol:1,kind:'captured',scope:'supplier_product_page',sourcePageUrl:productUrl,companyName,companyUrl:'https://synthetic.m.en.alibaba.com/?from=detail_company_card',productName,observedAt:new Date().toISOString(),snapshot:'Synthetic scoped attribute snapshot',pageText:[productName,companyName,...attributes.map(x=>x.excerpt)].join(nl),attributes};
 if(live){
  directory=await mkdtemp(path.join(tmpdir(),'forge-detail-delivery-'));
  adapter=createAsideAdapter({directory,origin,deviceId,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT});
  const result=await adapter.collect(detailClaim.envelope);assert.equal(result.kind,'captured');assert.equal(result.taskHash,detailClaim.taskHash);
  observation=result.observation;
  assert.equal((await adapter.collect(detailClaim.envelope)).kind,'pending_reconciliation','No second live read before receipt');
 }
 for(const changed of [{companyUrl:'https://different.en.alibaba.com/'},{sourcePageUrl:'https://www.alibaba.com/product-detail/Different_999999.html'}]){
  const rejected=await call('/api/bridge/tasks/'+detail.taskId+'/results',{taskHash:detailClaim.taskHash,observation:{...observation,...changed}});
  assert.equal(rejected.status,409);assert.equal(rejected.body.code,'TASK_STALE');
 }
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM browser_task_results WHERE task_id=$1',[detail.taskId])).rows[0].n,0,'Wrong product or seller cannot create a receipt');
 const beforeFailure=(await test.pool.query("SELECT (SELECT count(*)::int FROM supplier_captures WHERE candidate_id=$1) AS captures,(SELECT count(*)::int FROM sourcing_suppliers WHERE candidate_id=$1) AS suppliers,(SELECT count(*)::int FROM pgboss.job WHERE data->>'candidateId'=$1::text) AS jobs",[candidate.id])).rows[0];
 const send=test.boss.send;let failureInjected=0;
 test.boss.send=async(...args)=>{await send.apply(test.boss,args);failureInjected++;throw new Error('Synthetic failure after transactional job insert');};
 try{assert.equal((await call('/api/bridge/tasks/'+detail.taskId+'/results',{taskHash:detailClaim.taskHash,observation})).status,500);}
 finally{test.boss.send=send;}
 assert.equal(failureInjected,1);
 assert.deepEqual((await test.pool.query("SELECT (SELECT count(*)::int FROM supplier_captures WHERE candidate_id=$1) AS captures,(SELECT count(*)::int FROM sourcing_suppliers WHERE candidate_id=$1) AS suppliers,(SELECT count(*)::int FROM pgboss.job WHERE data->>'candidateId'=$1::text) AS jobs",[candidate.id])).rows[0],beforeFailure);
 const rolledBack=(await call('/api/bridge/tasks/'+detail.taskId)).body;
 assert.equal(rolledBack.state,'delivered');assert.equal(rolledBack.receiptId,null);
 const submitted=await Promise.all([1,2].map(()=>call('/api/bridge/tasks/'+detail.taskId+'/results',{taskHash:detailClaim.taskHash,observation})));
 assert.deepEqual(submitted.map(r=>r.status).sort(),[200,201]);
 assert.equal(submitted[0].body.receiptId,submitted[1].body.receiptId);
 const accepted=submitted.find(r=>r.status===201);
 assert.ok(accepted);
 assert.equal((await call('/api/bridge/tasks/'+detail.taskId+'/results',{taskHash:detailClaim.taskHash,observation})).body.receiptId,accepted.body.receiptId);
 const stored=(await test.pool.query('SELECT body_ciphertext FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId).toString('utf8')),observation);
 if(live){adapter.confirmServerReceipt({taskId:detail.taskId,taskHash:detailClaim.taskHash,receiptId:accepted.body.receiptId});assert.equal((await adapter.collect(detailClaim.envelope)).kind,'completed');}
 const captures=(await test.pool.query('SELECT capture_method FROM supplier_captures WHERE candidate_id=$1 ORDER BY created_at,id',[candidate.id])).rows;
 assert.deepEqual(captures.map(x=>x.capture_method),['aside_search_result','aside_product_detail']);
 assert.equal(await prepareAutomaticRfqs(test.pool,candidate.id),live?0:1);
 const contact=(await test.call('/api/candidates/'+candidate.id+'/contact')).body;
 assert.equal(contact.drafts.length,live?0:1);if(!live)assert.equal(contact.drafts[0].state,'pending_approval');
 const boundaryCases=[],recoveryCases=[];
 if(!live){
  async function boundaryFixture(label){
   const keyword='Synthetic boundary '+label+' '+test.runId;
   const row=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",[keyword])).rows[0];
   await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[row.id,version,JSON.stringify({synthetic:true,inputVersion:1})]);
   const saved=await test.call('/api/candidates/'+row.id+'/specs',{...wanted,requestedQuantity:300,source:'Synthetic boundary fixture'});assert.equal(saved.status,201);
   const queuedSearch=await producer.queueSupplierSearch(test.pool,{deviceId,candidateId:row.id},signing);
   assert.equal(queuedSearch.kind,'queued');
   const claimSearch=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(claimSearch.taskId,queuedSearch.taskId);
   const source=await call('/api/bridge/tasks/'+queuedSearch.taskId+'/results',{taskHash:claimSearch.taskHash,observation:{...searchObservation,query:keyword,sourcePageUrl:'https://www.alibaba.com/search/page?SearchText='+encodeURIComponent(keyword),observedAt:new Date().toISOString()}});
   assert.equal(source.status,201);
   assert.equal((await producer.queueSupplierDetail(test.pool,{deviceId,candidateId:row.id,sourceCaptureId},signing)).kind,'not_ready','Another candidate source cannot authorize this detail');
   const sourceId=source.body.captureIds[0];
   const queued=await producer.queueSupplierDetail(test.pool,{deviceId,candidateId:row.id,sourceCaptureId:sourceId},signing);assert.equal(queued.kind,'queued');
   assert.equal((await producer.queueSupplierDetail(test.pool,{deviceId,candidateId:row.id,sourceCaptureId:sourceId},signing)).kind,'existing');
   const claim=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(claim.taskId,queued.taskId);
   return {candidateId:row.id,specId:saved.body.id,sourceId,claim,observation:{...observation,observedAt:new Date().toISOString()}};
  }
  for(const failurePoint of ['before-submit','after-commit']){
   const fixture=await boundaryFixture('recovery-'+failurePoint);
   const stateDirectory=await mkdtemp(path.join(tmpdir(),'forge-detail-recovery-'));
   const config={directory:stateDirectory,origin,deviceId,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString()};
   let ledger=openBrowserTaskLedger(config),reads=0;
   const client=createBridgeClient({origin}),readCredential=()=>deviceVault('read',{origin,deviceId});
   try{
    const collector={collect:async envelope=>{const claimed=ledger.claim(envelope);assert.equal(claimed.kind,'claimed');reads++;return {kind:'captured',taskId:claimed.taskId,taskHash:claimed.taskHash,observation:fixture.observation};}};
    const interrupted={...client,submitObservation:async input=>{if(failurePoint==='after-commit')await client.submitObservation(input);throw new Error('SYNTHETIC_CONNECTION_LOSS');}};
    await assert.rejects(createRecoveryCycle({client:interrupted,adapter:collector,ledger,deviceId,readCredential})(),/SYNTHETIC_CONNECTION_LOSS/);
    assert.deepEqual(ledger.staged(fixture.claim.taskId,await readCredential()),fixture.observation);
    ledger.close();ledger=openBrowserTaskLedger(config);
    assert.deepEqual(ledger.staged(fixture.claim.taskId,await readCredential()),fixture.observation,'A reopened ledger retains all detailed attribute excerpts');
    const recovered=await createRecoveryCycle({client,adapter:{collect:async()=>{throw new Error('DETAIL_BROWSER_MUST_NOT_REPEAT');}},ledger,deviceId,readCredential})();
    assert.equal(recovered.kind,'idle');assert.equal(reads,1);assert.equal(ledger.inspect(fixture.claim.taskId).state,'completed');
    assert.equal(ledger.staged(fixture.claim.taskId,await readCredential()),null);
    assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM browser_task_results WHERE task_id=$1',[fixture.claim.taskId])).rows[0].n,1);
    assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM supplier_captures WHERE candidate_id=$1',[fixture.candidateId])).rows[0].n,2);
    assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'candidateId'=$1",[fixture.candidateId])).rows[0].n,2,'One search continuation and one detail continuation');
    recoveryCases.push(failurePoint);
   }finally{
    ledger.close();assert.equal(path.dirname(path.resolve(stateDirectory)),path.resolve(tmpdir()));assert.ok(path.basename(stateDirectory).startsWith('forge-detail-recovery-'));await rm(stateDirectory,{recursive:true,force:true});
   }
  }
  for(const changed of ['input','spec','validation','expiry','settings']){
   const fixture=await boundaryFixture(changed);
   if(changed==='input')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[fixture.candidateId]);
   if(changed==='spec')assert.equal((await test.call('/api/candidates/'+fixture.candidateId+'/specs',{...wanted,dimensions:'40 cm',requestedQuantity:300,source:'Changed synthetic target'})).status,201);
   if(changed==='validation')await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','hold',$3::jsonb)",[fixture.candidateId,version,JSON.stringify({synthetic:true,inputVersion:1})]);
   if(changed==='settings')await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'synthetic boundary change',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1");
   if(changed==='expiry'){
    await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[fixture.claim.taskId]);
    const original=JSON.parse(Buffer.from(fixture.claim.envelope.payload,'base64url').toString('utf8')),now=Date.now(),id=randomUUID();
    const envelope=signBrowserTask({...original,id,issuedAt:new Date(now-120000).toISOString(),expiresAt:new Date(now-60000).toISOString()},keys.privateKey);
    const hash=createHash('sha256').update(envelope.payload).digest('hex');
    await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,state,expires_at,delivered_at,source_capture_id,task_kind) VALUES($1,$2,$3,$4,1,$5,$6::jsonb,$7,'delivered',$8,$9,$10,'supplier_detail')",[id,deviceId,fixture.candidateId,fixture.specId,version,JSON.stringify(envelope),hash,new Date(now-60000),new Date(now-100000),fixture.sourceId]);
    fixture.claim={taskId:id,taskHash:hash,envelope};fixture.observation.observedAt=new Date(now-90000).toISOString();
   }
   const rejected=await call('/api/bridge/tasks/'+fixture.claim.taskId+'/results',{taskHash:fixture.claim.taskHash,observation:fixture.observation});
   assert.equal(rejected.status,409,changed+' must block detail intake');assert.equal(rejected.body.code,'TASK_STALE');
   assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM browser_task_results WHERE task_id=$1',[fixture.claim.taskId])).rows[0].n,0);
   assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM supplier_captures WHERE candidate_id=$1',[fixture.candidateId])).rows[0].n,1,'Only the original search capture remains');
   assert.equal((await call('/api/bridge/tasks/claim',{})).body.kind,'idle');
   assert.equal((await call('/api/bridge/tasks/'+fixture.claim.taskId)).body.state,'cancelled');
   boundaryCases.push(changed);
  }
  assert.equal((await call('/api/bridge/tasks/'+detail.taskId+'/results',{taskHash:detailClaim.taskHash,observation})).body.receiptId,accepted.body.receiptId,'Old receipt remains stable after settings change');
 }
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM external_actions')).rows[0].n,0);
 console.log(JSON.stringify({scenario:'supplier-detail-integration',result:'PASS',realLocalHttp:true,sourceBoundDetail:true,immutableSourceMethods:true,exactListingToPendingRfq:!live,duplicateReceipt:true,concurrentSingleReceipt:true,transactionalJobFailureRolledBack:true,boundaryCases,recoveryCases,nativeVaultClient:true,wrongSellerAndProductRejected:true,encryptedObservationRoundtrip:true,liveAsideDetail:live,publicProductReads:live?1:0,incompleteLiveListingBlocksRfq:live,syntheticSearchSeed:true,realProviderCalls:0,externalMessages:0}));
}finally{
 try{adapter?.close();if(vaultStored)await deviceVault('remove',{origin,deviceId,credential});}
 finally{
  await test.close();
  if(directory){assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('forge-detail-delivery-'));await rm(directory,{recursive:true,force:true});}
 }
}
