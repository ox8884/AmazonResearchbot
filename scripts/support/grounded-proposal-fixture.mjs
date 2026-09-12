import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {browserSigningFixture} from './browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../../apps/worker/src/browser-signing-key.ts';
import {queueAmazonPackage} from '../../apps/worker/src/browser-task-producer.ts';
import {runCandidateAiWork} from '../../apps/worker/src/ai-business.ts';

export async function groundedProposalFixture(test,{materialize=true,webOrigin='http://localhost:5173'}={}){
 const key=Buffer.from(test.encryptionKeyHex,'hex'),asin='B0DF000001';
 const settings=(await test.call('/api/settings')).body.version;
 const candidateId=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",['실리콘 주걱 · 차별화 근거 검증 '+test.runId])).rows[0].id;
 await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[candidateId,JSON.stringify({representativeAsin:asin,actor:'synthetic-fixture'})]);
 const keys=browserSigningFixture(),identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pair=(await test.call('/api/bridge/pairings',{})).body;
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pair.pairingCode,name:'Synthetic differentiation source'});assert.equal(enrolled.status,201);
 const deviceCall=(path,body)=>test.call(path,body,{authorization:'Bearer '+enrolled.body.credential});
 assert.equal((await deviceCall('/api/bridge/capabilities',{connected:true,supportedTasks:['amazon_package'],keyFingerprint:identity.fingerprint})).status,200);
 const task=await queueAmazonPackage(test.pool,{deviceId:enrolled.body.id,candidateId},{origin:webOrigin,privateKey:keys.privateKey});assert.equal(task.kind,'queued');
 const claim=(await deviceCall('/api/bridge/tasks/claim',{})).body;assert.equal(claim.taskId,task.taskId);
 const rows=[{label:'ASIN',value:asin},{label:'Package Dimensions',value:'10 x 4 x 2 inches; 1 pounds'}].map(row=>({...row,excerpt:row.label+' '+row.value}));
 const observation={protocol:1,kind:'captured',scope:'amazon_product_page',asin,sourcePageUrl:'https://www.amazon.com/dp/'+asin,observedAt:new Date().toISOString(),snapshot:'Synthetic differentiation product source',pageText:rows.map(row=>row.excerpt).join('\n'),rows,
  productEvidence:{basis:'listing_claims_and_review_excerpts',title:'Synthetic silicone spatula',claims:['Silicone blade with a thick edge'],reviews:[{id:'RDIFF0001',title:'Blade edge',bodyExcerpt:'The blade edge is too thick to slide under eggs.',ratingText:'2 out of 5 stars',variantLabel:'Single spatula',variantPath:'/portal/customer-reviews/'+asin,reviewedAsin:asin}]}};
 const receipt=await deviceCall('/api/bridge/tasks/'+task.taskId+'/results',{taskHash:claim.taskHash,observation});assert.equal(receipt.status,201);
 const profile=await test.call('/api/custom-ai',{version:0,name:'Synthetic grounded proposal',model:'grounded-proposal-fixture',baseUrl:'https://grounded-proposal.fixture.invalid/v1',apiKey:'SYNTHETIC_GROUNDED_PROPOSAL_KEY',dailyBudgetUsd:'2.00',roles:['niche_analysis'],priority:0,inputUsdPerMillion:'1',outputUsdPerMillion:'2',maxInputTokens:4096,maxOutputTokens:2048});assert.equal(profile.status,201);
 const grant=await test.call('/api/custom-ai/'+profile.body.profile.id+'/activation-proposals',{version:1,productEvidenceScope:'short-excerpts-v1'});assert.equal((await test.call('/api/approvals/'+grant.body.approvalId+'/approve',{})).status,200);
 const target={material:'Silicone target',dimensions:'30 cm overall target',packaging:'Individual box target',requirements:'Target blade edge thickness 1 mm; supplier must confirm',requestedQuantity:300,rationale:'Comparison target addressing the sampled complaint; feasibility unverified',sourceRefs:['claim:0','review:RDIFF0001']};
 const proposal={status:'proposed',customerProblem:'The sampled review reports difficulty sliding under eggs.',featureRefs:['claim:0'],reviewRefs:['review:RDIFF0001'],change:{field:'requirements',proposedValue:target.requirements}};
 let calls=0;
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
  const input=JSON.parse(body.messages[1].content);calls++;
  assert.equal(input.productSource.receiptId,receipt.body.receiptId);assert.equal(input.productSource.asin,asin);
  assert.deepEqual(input.sourceExcerpts.map(row=>row.ref),['claim:0','review:RDIFF0001']);
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify({role:'niche_analysis',summary:'근거에 연결한 변경 제안 · 실물 미확인',suggestions:[],differentiationProposal:proposal,targetSpecification:target})}}],usage:{prompt_tokens:150,completion_tokens:200}}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const transport={kind:'ready',send:async input=>{
  assert.equal(input.baseUrl,'https://grounded-proposal.fixture.invalid/v1');
  const response=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:input.messages}),signal:AbortSignal.timeout(5000)});
  return {kind:'response',status:response.status,body:await response.json()};
 }};
 try{
  assert.equal((await runCandidateAiWork(test.pool,candidateId,'niche_analysis',{transport,encryptionKey:key})).kind,'succeeded');
  const sourceTask=(await test.call('/api/candidates/'+candidateId+'/ai-analysis')).body.tasks.find(row=>row.role==='niche_analysis');
  assert.deepEqual(sourceTask.result.differentiationProposal,proposal);assert.deepEqual(sourceTask.result.targetSpecification,target);
  assert.equal((await test.pool.query('SELECT count(*)::int n FROM spec_revisions WHERE candidate_id=$1',[candidateId])).rows[0].n,0,'An unvalidated niche proposal cannot create a sourcing specification');
  assert.equal((await test.pool.query("SELECT count(*)::int n FROM evidence WHERE candidate_id=$1 AND field='differentiation' AND kind<>'unknown'",[candidateId])).rows[0].n,0);
  await test.pool.query("UPDATE candidates SET stage='sourcing',blocked_reason=NULL WHERE id=$1",[candidateId]);
  await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[candidateId,settings,JSON.stringify({synthetic:true,inputVersion:1})]);
  let specId=null;
  if(materialize){
   const results=await Promise.all([runCandidateAiWork(test.pool,candidateId,'sourcing_analysis',{transport:{kind:'disabled'},encryptionKey:key}),runCandidateAiWork(test.pool,candidateId,'sourcing_analysis',{transport:{kind:'disabled'},encryptionKey:key})]);
   assert.ok(results.every(row=>row.kind==='proposal_reused'));assert.equal(new Set(results.map(row=>row.specId)).size,1);
   const specs=(await test.call('/api/candidates/'+candidateId+'/sourcing')).body.specs;assert.equal(specs.length,1);specId=specs[0].id;
   assert.equal(specs[0].aiTaskId,sourceTask.id);assert.equal(specs[0].requirements,target.requirements);assert.equal(specs[0].requestedQuantity,target.requestedQuantity);
  }
  assert.equal(calls,1,'Sourcing handoff must reuse the niche proposal without another model call');
  return {candidateId,specId,aiTaskId:sourceTask.id,target,proposal,receiptId:receipt.body.receiptId,calls,entryPath:'/candidates/'+candidateId};
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
