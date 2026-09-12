import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAsideAdapter} from '../apps/browser-bridge/aside-adapter.mjs';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import * as producer from '../apps/worker/src/browser-task-producer.ts';
import {loadCanonicalNicheEvidence} from '../apps/worker/src/api-validation-store.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';
import {dispatchBrowserWork} from '../apps/worker/src/browser-dispatch.ts';
import {readProductSource,resolveAiProductSource} from '../packages/integrations/src/amazon/product-source.ts';
import {runCandidateAiWork} from '../apps/worker/src/ai-business.ts';
import {finishCandidateAiTask} from '../packages/db/src/ai-business-tasks.ts';

assert.equal(typeof producer.queueAmazonPackage,'function','Package task producer must exist');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const address=reservation.address();assert.ok(address&&typeof address==='object');await new Promise(resolve=>reservation.close(resolve));
const origin='http://127.0.0.1:'+address.port;
const test=await openAcceptance({databaseKey:'package-task-'+Date.now(),webOrigin:origin});
let adapter,directory,liveResult=null;
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const keys=browserSigningFixture();
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pair=(await test.call('/api/bridge/pairings',{})).body;
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pair.pairingCode,name:'Synthetic package reader'});
 assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id,headers={authorization:'Bearer '+enrolled.body.credential,origin};
 const call=async(path,body)=>{
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['amazon_package'],keyFingerprint:identity.fingerprint})).status,200);
 const asin='B0QA000001';
 async function candidate(label,representative=asin){
  const c=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",['Package '+label+' '+test.runId])).rows[0];
  await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[c.id,JSON.stringify({representativeAsin:representative})]);
  return c.id;
 }
 const candidateId=await candidate('known');
 const sourcePath='/api/candidates/'+candidateId+'/product-source';
 assert.equal((await test.call(sourcePath)).body.state,'not_collected');
 const signing={origin,privateKey:keys.privateKey};
 const foreignId=await candidate('foreign');
 await test.pool.query("UPDATE candidates SET marketplace='ca' WHERE id=$1",[foreignId]);
 assert.equal((await producer.queueAmazonPackage(test.pool,{deviceId,candidateId:foreignId},signing)).kind,'not_ready','US package policy cannot bind a foreign-market candidate');
 const task=await producer.queueAmazonPackage(test.pool,{deviceId,candidateId},signing);
 assert.equal(task.kind,'queued');
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM spec_revisions WHERE candidate_id=$1',[candidateId])).rows[0].n,0,'Package evidence must not invent a spec');
 const claimed=(await call('/api/bridge/tasks/claim',{})).body;
 assert.equal((await test.call(sourcePath)).body.state,'collecting');
 assert.equal(claimed.taskId,task.taskId);
 const request=JSON.parse(Buffer.from(claimed.envelope.payload,'base64url')).request;
 assert.equal(request.kind,'amazon_package');assert.equal(request.asin,asin);assert.equal(request.specId,undefined);
 const rows=[{label:'ASIN',value:asin},{label:'Package Dimensions',value:'18 x 14 x 8 inches; 20 pounds'}].map(row=>({...row,excerpt:row.label+' '+row.value}));
 const productEvidence={basis:'listing_claims_and_review_excerpts',title:'Synthetic spatula',claims:['Silicone blade'],reviews:[{id:'RTEST0001',title:'Thick edge',bodyExcerpt:'The blade is too thick for eggs.',ratingText:'4 out of 5 stars',variantLabel:'Size: 4 pieces',variantPath:'/portal/customer-reviews/B0QA000002',reviewedAsin:'B0QA000002'}]};
 productEvidence.reviews.push({id:'RTEST0002',title:'No variant link',bodyExcerpt:'The handle is sturdy.',ratingText:null,variantLabel:null,variantPath:null,reviewedAsin:null});
 const observation={protocol:1,kind:'captured',scope:'amazon_product_page',asin,sourcePageUrl:'https://www.amazon.com/dp/'+asin,observedAt:new Date().toISOString(),snapshot:'Synthetic package snapshot',pageText:rows.map(r=>r.excerpt).join('\n'),rows,productEvidence};
 const submit=obs=>call('/api/bridge/tasks/'+task.taskId+'/results',{taskHash:claimed.taskHash,observation:obs});
 assert.equal((await submit({...observation,asin:'B0QA000002'})).status,400);
 for(const review of [
  {...productEvidence.reviews[0],reviewedAsin:asin},
  {...productEvidence.reviews[0],variantPath:null},
  {...productEvidence.reviews[0],author:'Do not collect reviewer profiles'},
 ])assert.equal((await submit({...observation,productEvidence:{...productEvidence,reviews:[review]}})).status,400);
 const send=test.boss.send;
 test.boss.send=async(...args)=>{await send.apply(test.boss,args);throw Error('Synthetic enqueue failure');};
 try{assert.equal((await submit(observation)).status,500);}finally{test.boss.send=send;}
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM evidence WHERE candidate_id=$1',[candidateId])).rows[0].n,0,'Queue failure rolls back package evidence');
 assert.equal((await call('/api/bridge/tasks/'+task.taskId)).body.state,'delivered');
 const accepted=await submit(observation);assert.equal(accepted.status,201);
 const sourceView=await test.call(sourcePath);
 assert.equal(sourceView.status,200);assert.equal(sourceView.body.state,'captured');
 assert.deepEqual(sourceView.body.productEvidence,productEvidence);
 assert.equal(sourceView.body.asin,asin);
 const aiSource=await readProductSource(test.pool,candidateId,Buffer.from(test.encryptionKeyHex,'hex'));
 assert.equal(aiSource.state,'captured');
 assert.equal(aiSource.reference.receiptId,accepted.body.receiptId);
 assert.deepEqual(aiSource.excerpts,[{ref:'claim:0',kind:'claim',text:'Silicone blade'}],'Other and unconfirmed review variants cannot enter the AI source');
 assert.equal(JSON.stringify(aiSource.reference).includes('Silicone blade'),false,'The stored AI reference must not duplicate source text');
 assert.equal(JSON.stringify(aiSource.reference).includes('Thick edge'),false);
 assert.deepEqual(await resolveAiProductSource(test.pool,candidateId,aiSource.reference,Buffer.from(test.encryptionKeyHex,'hex')),aiSource.excerpts);
 assert.equal(await resolveAiProductSource(test.pool,candidateId,{...aiSource.reference,fragments:[{...aiSource.reference.fragments[0],sha256:'0'.repeat(64)}]},Buffer.from(test.encryptionKeyHex,'hex')),null,'Changed excerpt fingerprint cannot resolve');
 assert.equal(await resolveAiProductSource(test.pool,candidateId,{...aiSource.reference,asin:'B0QA000002'},Buffer.from(test.encryptionKeyHex,'hex')),null);
 await assert.rejects(readProductSource(test.pool,candidateId,Buffer.alloc(32)),'Wrong encryption key cannot expose a fallback source');
 const aiProfile=await test.call('/api/custom-ai',{version:0,name:'Grounded source fixture',model:'grounded-fixture',baseUrl:'https://grounded.fixture.invalid/v1',apiKey:'SYNTHETIC_GROUNDED_KEY_7392',dailyBudgetUsd:'2.00',roles:['niche_analysis'],priority:1,inputUsdPerMillion:'1',outputUsdPerMillion:'2',maxInputTokens:4096,maxOutputTokens:2048});assert.equal(aiProfile.status,201);
 const providerPath='/api/custom-ai/'+aiProfile.body.profile.id;
 const oldGrant=await test.call(providerPath+'/activation-proposals',{version:1});assert.equal((await test.call('/api/approvals/'+oldGrant.body.approvalId+'/approve',{})).status,200);
 let aiCalls=0;
 const aiOptions={encryptionKey:Buffer.from(test.encryptionKeyHex,'hex'),transport:{kind:'ready',send:async input=>{
  aiCalls++;const request=JSON.parse(input.messages[1].content);
  assert.deepEqual(request.sourceExcerpts,aiSource.excerpts);assert.deepEqual(request.productSource,aiSource.reference);
  const output={role:'niche_analysis',summary:'Source-linked suggestion, implementation unconfirmed',suggestions:[{text:'Compare a thinner blade target',sourceRefs:['claim:0']}]};
  return {kind:'response',status:200,body:{choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:100}}};
 }}};
 assert.equal((await runCandidateAiWork(test.pool,candidateId,'niche_analysis',aiOptions)).kind,'no_provider','Earlier numeric-only approval cannot authorize source excerpts');assert.equal(aiCalls,0);
 const groundedTask=(await test.pool.query("SELECT id,input_payload FROM ai_business_tasks WHERE candidate_id=$1 AND role='niche_analysis' ORDER BY created_at DESC LIMIT 1",[candidateId])).rows[0];
 assert.deepEqual(groundedTask.input_payload.productSource,aiSource.reference);
 assert.equal(JSON.stringify(groundedTask.input_payload).includes('Silicone blade'),false,'Plaintext AI task contains references only');
 let scopeGrant=await test.call(providerPath+'/activation-proposals',{version:1,productEvidenceScope:'short-excerpts-v1'});assert.equal(scopeGrant.status,201);assert.notEqual(scopeGrant.body.approvalId,oldGrant.body.approvalId);
 const visibleScope=(await test.call('/api/custom-ai')).body.profiles.find(profile=>profile.id===aiProfile.body.profile.id);
 assert.equal(visibleScope.productEvidenceScope,'short-excerpts-v1');assert.equal(visibleScope.approvalId,scopeGrant.body.approvalId);
 assert.equal((await runCandidateAiWork(test.pool,candidateId,'niche_analysis',aiOptions)).kind,'no_provider');assert.equal(aiCalls,0,'Pending scope approval cannot transmit');
 const narrowed=await test.call(providerPath+'/activation-proposals',{version:1});assert.equal(narrowed.status,201,'Changing a pending scope cannot reuse an older approved grant');
 assert.equal((await test.call('/api/approvals/'+scopeGrant.body.approvalId+'/approve',{})).status,409,'Superseded broader scope must not activate');
 assert.equal((await test.call('/api/custom-ai')).body.profiles.find(profile=>profile.id===aiProfile.body.profile.id).productEvidenceScope,null);
 scopeGrant=await test.call(providerPath+'/activation-proposals',{version:1,productEvidenceScope:'short-excerpts-v1'});assert.equal(scopeGrant.status,201);
 assert.equal((await test.call('/api/approvals/'+narrowed.body.approvalId+'/approve',{})).status,409);
 assert.equal((await test.call('/api/approvals/'+scopeGrant.body.approvalId+'/approve',{})).status,200);
 assert.equal((await runCandidateAiWork(test.pool,candidateId,'niche_analysis',aiOptions)).kind,'succeeded');assert.equal(aiCalls,1);
 assert.equal((await runCandidateAiWork(test.pool,candidateId,'niche_analysis',aiOptions)).kind,'already_handled');assert.equal(aiCalls,1);
 for(const field of ['snapshot','pageText','body_ciphertext','receiptId'])assert.equal(field in sourceView.body,false);
 assert.equal((await test.app.inject({method:'GET',url:sourcePath})).statusCode,401);
 await test.pool.query("UPDATE candidate_events SET detail=jsonb_set(detail,'{representativeAsin}',to_jsonb($2::text)) WHERE candidate_id=$1",[candidateId,'B0QA000002']);
 assert.equal((await test.call(sourcePath)).body.state,'stale','A receipt for another selected ASIN is not current product evidence');
 assert.equal(await resolveAiProductSource(test.pool,candidateId,aiSource.reference,Buffer.from(test.encryptionKeyHex,'hex')),null,'Changing the representative invalidates AI source references too');
 await finishCandidateAiTask(test.pool,groundedTask.id);
 assert.equal((await test.pool.query('SELECT state FROM ai_business_tasks WHERE id=$1',[groundedTask.id])).rows[0].state,'stale','An AI result cannot outlive its representative source');
 await test.pool.query("UPDATE candidate_events SET detail=jsonb_set(detail,'{representativeAsin}',to_jsonb($2::text)) WHERE candidate_id=$1",[candidateId,asin]);
 const duplicate=await submit(observation);assert.equal(duplicate.status,200);assert.equal(duplicate.body.receiptId,accepted.body.receiptId);
 const canonical=await loadCanonicalNicheEvidence(test.pool,candidateId);
 assert.equal(canonical.differentiation.kind,'unknown','Listing claims and a review do not establish an implemented differentiation path');
 assert.equal(canonical.standardSize.kind,'measured');assert.equal(canonical.standardSize.value,true);
 const stored=(await test.pool.query('SELECT body_ciphertext FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId)),observation);
 assert.equal((await producer.queueAmazonPackage(test.pool,{deviceId,candidateId},signing)).kind,'existing');
 const unknownId=await candidate('item-only');
 assert.equal((await dispatchBrowserWork(test.pool,{...signing,fingerprint:identity.fingerprint})).queued,1,'Package-capable device dispatches before specifications');
 const unknownClaim=(await call('/api/bridge/tasks/claim',{})).body;
 const unknownRows=[{label:'ASIN',value:asin},{label:'Item Dimensions',value:'10 x 2 x 2 inches'},{label:'Item Weight',value:'4.8 ounces'}].map(row=>({...row,excerpt:row.label+' '+row.value}));
 const unknownObservation={...observation,productEvidence:undefined,observedAt:new Date().toISOString(),rows:unknownRows,pageText:unknownRows.map(r=>r.excerpt).join('\n')};
 assert.equal((await call('/api/bridge/tasks/'+unknownClaim.taskId+'/results',{taskHash:unknownClaim.taskHash,observation:unknownObservation})).status,201);
 assert.equal((await loadCanonicalNicheEvidence(test.pool,unknownId)).standardSize.kind,'unknown','Item measurements cannot qualify a package');
 assert.equal((await test.call('/api/candidates/'+unknownId+'/product-source')).body.state,'legacy');
 assert.equal((await dispatchBrowserWork(test.pool,{...signing,fingerprint:identity.fingerprint})).queued,0,'Completed unknown observation is not repeatedly collected');
 for(const change of ['input','settings','selection','observation-time']){
  const id=await candidate(change),queued=await producer.queueAmazonPackage(test.pool,{deviceId,candidateId:id},signing);
  assert.equal(queued.kind,'queued');const claim=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(claim.taskId,queued.taskId);
  const observed={...observation,observedAt:new Date().toISOString()};
  if(change==='input')await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[id]);
  if(change==='selection')await test.pool.query("UPDATE candidate_events SET detail=$2::jsonb WHERE candidate_id=$1",[id,JSON.stringify({representativeAsin:'B0QA000002'})]);
  if(change==='settings')await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'package fixture',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1");
  if(change==='observation-time')observed.observedAt='2020-01-01T00:00:00.000Z';
  const result=await call('/api/bridge/tasks/'+queued.taskId+'/results',{taskHash:claim.taskHash,observation:observed});assert.equal(result.status,409,change);
  assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM evidence WHERE candidate_id=$1',[id])).rows[0].n,0);
  await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[id]);
 }
 assert.equal((await test.call(sourcePath)).body.state,'stale','Earlier settings invalidate the source projection');
 if(process.argv.includes('--live')){
  const liveAsin='B0CHGFG64S',liveId=await candidate('live-browser',liveAsin);
  const liveTask=await producer.queueAmazonPackage(test.pool,{deviceId,candidateId:liveId},signing);
  assert.equal(liveTask.kind,'queued');const claim=(await call('/api/bridge/tasks/claim',{})).body;assert.equal(claim.taskId,liveTask.taskId);
  directory=await mkdtemp(path.join(tmpdir(),'forge-package-read-'));
  adapter=createAsideAdapter({directory,origin,deviceId,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT});
  assert.ok((await adapter.probe()).supportedTasks.includes('amazon_package'));
  const capture=await adapter.collect(claim.envelope);assert.equal(capture.kind,'captured','Actual ASIDE package observation required');
  assert.equal(capture.observation.asin,liveAsin);
  assert.ok(capture.observation.productEvidence.claims.length>0,'Actual listing claims required');
  assert.ok(capture.observation.productEvidence.reviews.length>0,'Actual product-page review excerpts required');
  assert.equal((await adapter.collect(claim.envelope)).kind,'pending_reconciliation','Do not read again before receipt');
  const receipt=await call('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation:capture.observation});assert.equal(receipt.status,201);
  const evidence=await loadCanonicalNicheEvidence(test.pool,liveId);
  const liveView=await test.call('/api/candidates/'+liveId+'/product-source');
  assert.equal(liveView.body.state,'captured');assert.deepEqual(liveView.body.productEvidence,capture.observation.productEvidence);
  assert.equal(evidence.differentiation.kind,'unknown','Live source collection alone must not pass differentiation');
  if(!capture.observation.rows.some(row=>row.label==='Package Dimensions'))assert.equal(evidence.standardSize.kind,'unknown');
  const cipher=(await test.pool.query('SELECT body_ciphertext FROM browser_task_results WHERE id=$1',[receipt.body.receiptId])).rows[0].body_ciphertext;
  assert.deepEqual(JSON.parse(decryptSecret(cipher,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+receipt.body.receiptId)),capture.observation);
  adapter.confirmServerReceipt({taskId:claim.taskId,taskHash:claim.taskHash,receiptId:receipt.body.receiptId});
  assert.equal((await adapter.collect(claim.envelope)).kind,'completed');
  liveResult={asin:liveAsin,rows:capture.observation.rows.length,claims:capture.observation.productEvidence.claims.length,reviews:capture.observation.productEvidence.reviews.length,standard:evidence.standardSize.kind,differentiation:evidence.differentiation.kind,realReceipt:true,sameTaskNotRepeated:true};
  await writeFile(new URL('../.omo/evidence/catalog-measurements/package-live-observation.json',import.meta.url),JSON.stringify({syntheticCandidate:true,syntheticDevice:true,actualBrowserSource:true,observation:capture.observation,standard:evidence.standardSize},null,2));
 }
 console.log(JSON.stringify({scenario:'package-task',result:'PASS',realLocalHttp:true,withoutSpec:true,transactionalRollback:true,duplicateReceipt:true,staleRejected:true,liveResult,paidCalls:0,externalMessages:0}));
}finally{
 adapter?.close();
 await test.close();
 if(directory){assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('forge-package-read-'));await rm(directory,{recursive:true,force:true});}
}
