import {spawn} from 'node:child_process';
import {groundedProposalFixture} from './support/grounded-proposal-fixture.mjs';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {prepareCandidateAiTask,finishCandidateAiTask} from '../packages/db/src/ai-business-tasks.ts';
import {executeApprovedAiBusiness} from '../packages/integrations/src/ai/execute.ts';
import {materializeProposedSpec,recoverProposedSpecs} from '../apps/worker/src/automatic-spec.ts';
import {createServer} from "node:http";
import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {runCandidateAiWork} from '../apps/worker/src/ai-business.ts';
import {advanceCandidate} from '../apps/worker/src/advance-candidate.ts';
import {resolveTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
const key=Buffer.from('42'.repeat(32),'hex');
const test=await openAcceptance({databaseKey:'ai-business-'+Date.now(),encryptionKeyHex:key.toString('hex')});
let calls=0;
const localServers=[];
async function candidate(label){return (await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",['spatula '+label+' '+test.runId])).rows[0].id;}
function response(input,override={}){
 const request=JSON.parse(input.messages[1].content);assert.ok(!JSON.stringify(request).includes('PRIVATE_EMAIL_SENTINEL'));assert.equal(request.role==='normalize'||request.role==='niche_analysis'||request.role==='sourcing_analysis'||request.role==='rfq_draft',true);
 const data={role:request.role,summary:'근거를 추가 확인하세요.',suggestions:[{text:'입력된 근거를 비교하세요.',sourceRefs:[request.evidence[0]?.ref??'subject']}],...(request.role==='normalize'?{normalizedKeyword:'spatula'}:{}),...(request.role==='sourcing_analysis'?{searchQueries:['silicone spatula supplier']}:{}),...(request.role==='rfq_draft'?{draftText:'Please confirm MOQ and DDP pricing for the requested specification.'}:{}),...override};
 return {kind:'response',status:200,body:{choices:[{message:{content:JSON.stringify(data)}}],usage:{prompt_tokens:100,completion_tokens:100}}};
}
const transport={kind:'ready',send:async input=>{calls++;return response(input);}};
try{
 const migrationDb=await test.pool.connect();
 try{
  await migrationDb.query('BEGIN');
  const schema='ai_identity_'+test.runId;
  await migrationDb.query(`CREATE SCHEMA ${schema}`);await migrationDb.query(`SET LOCAL search_path TO ${schema},pg_catalog`);
  await migrationDb.query(`CREATE TABLE ai_business_tasks(id uuid PRIMARY KEY,candidate_id uuid NOT NULL,input_version integer NOT NULL,
   settings_version integer NOT NULL,role text NOT NULL,spec_id uuid,input_payload jsonb NOT NULL,
   CONSTRAINT ai_business_tasks_candidate_id_input_version_settings_versi_key UNIQUE NULLS NOT DISTINCT(candidate_id,input_version,settings_version,role,spec_id))`);
  await migrationDb.query("CREATE FUNCTION guard_ai_business_input() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$");
  await migrationDb.query('CREATE TRIGGER ai_business_input_immutable BEFORE UPDATE ON ai_business_tasks FOR EACH ROW EXECUTE FUNCTION guard_ai_business_input()');
  const payload={role:'niche_analysis',subject:'synthetic migration source',spec:null,evidence:[]};
  const insert="INSERT INTO ai_business_tasks(id,candidate_id,input_version,settings_version,role,input_payload) VALUES($1,'00000000-0000-4000-8000-000000000002',1,1,'niche_analysis',$2::jsonb)";
  await migrationDb.query(insert,['00000000-0000-4000-8000-000000000001',JSON.stringify(payload)]);
  await migrationDb.query(await readFile(new URL('../packages/db/sql/0042_ai_input_identity.sql',import.meta.url),'utf8'));
  const migrated=(await migrationDb.query('SELECT input_payload,octet_length(input_hash) AS hash_bytes FROM ai_business_tasks')).rows[0];
  assert.deepEqual(migrated.input_payload,payload);assert.equal(migrated.hash_bytes,32);
  await migrationDb.query('SAVEPOINT duplicate_input');
  await assert.rejects(migrationDb.query(insert,['00000000-0000-4000-8000-000000000003',JSON.stringify({evidence:[],spec:null,subject:payload.subject,role:payload.role})]),error=>error.code==='23505');
  await migrationDb.query('ROLLBACK TO SAVEPOINT duplicate_input');
  await migrationDb.query(insert,['00000000-0000-4000-8000-000000000003',JSON.stringify({...payload,subject:'changed source'})]);
  assert.equal((await migrationDb.query('SELECT count(*)::int n FROM ai_business_tasks')).rows[0].n,2);
  await assert.rejects(migrationDb.query("UPDATE ai_business_tasks SET input_hash=decode(repeat('00',32),'hex')"),/immutable/);
 }finally{await migrationDb.query('ROLLBACK');migrationDb.release();}
 const saved=await test.call('/api/custom-ai',{version:0,name:'Business fixture',model:'business-model',baseUrl:'https://business.fixture.invalid/v1',apiKey:'SYNTHETIC_"BUSINESS_KEY_7392',dailyBudgetUsd:'2.00',roles:['normalize','niche_analysis','sourcing_analysis','rfq_draft'],priority:1,inputUsdPerMillion:'1',outputUsdPerMillion:'2',maxInputTokens:4096,maxOutputTokens:2048,retentionPolicyUrl:null});assert.equal(saved.status,201);
 const grant=await test.call(`/api/custom-ai/${saved.body.profile.id}/activation-proposals`,{version:1});assert.equal((await test.call(`/api/approvals/${grant.body.approvalId}/approve`,{})).status,200);
 const id=await candidate('all-roles');
 await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at) VALUES($1,'contact_email','measured','PRIVATE_EMAIL_SENTINEL','synthetic',now())",[id]);
 await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,reason) VALUES($1,'reviews','unknown','not provided')",[id]);
 const before=(await test.pool.query('SELECT count(*)::int AS n FROM evidence WHERE candidate_id=$1',[id])).rows[0].n;
 for(const role of ['normalize','niche_analysis','sourcing_analysis','rfq_draft'])assert.equal((await runCandidateAiWork(test.pool,id,role,{transport,encryptionKey:key})).kind,'succeeded');
 assert.equal(calls,4);
 let view=await test.call(`/api/candidates/${id}/ai-analysis`);assert.equal(view.status,200);assert.equal(view.body.tasks.length,4);assert.ok(view.body.tasks.every(task=>task.state==='succeeded'&&task.result));
 assert.ok(view.body.tasks.every(task=>task.input.evidence.every(row=>row.field!=='contact_email')));assert.equal(view.body.tasks[0].input.evidence[0].value,null);
 assert.equal((await runCandidateAiWork(test.pool,id,'niche_analysis',{transport,encryptionKey:key})).kind,'already_handled');assert.equal(calls,4);
 const refreshId=await candidate('new-evidence');
 await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,reason) VALUES($1,'top_price','unknown','Not yet observed')",[refreshId]);
 await runCandidateAiWork(test.pool,refreshId,'niche_analysis',{transport,encryptionKey:key});
 const oldTask=(await test.call(`/api/candidates/${refreshId}/ai-analysis`)).body.tasks[0];
 await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,value_numeric,source_id,observed_at) VALUES($1,'top_price','measured',25,'synthetic-price',now())",[refreshId]);
 assert.equal((await runCandidateAiWork(test.pool,refreshId,'niche_analysis',{transport,encryptionKey:key})).kind,'succeeded','New AI input evidence must create a new analysis');
 const freshView=(await test.call(`/api/candidates/${refreshId}/ai-analysis`)).body;
 assert.equal(freshView.tasks.length,1);assert.notEqual(freshView.tasks[0].id,oldTask.id);
 assert.equal(Number(freshView.tasks[0].input.evidence[0].value),25);
 assert.equal((await runCandidateAiWork(test.pool,refreshId,'niche_analysis',{transport,encryptionKey:key})).kind,'already_handled','Identical input must reuse its operation');
 await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at) VALUES($1,'contact_email','measured','PRIVATE_EMAIL_SENTINEL','synthetic',now())",[refreshId]);
 assert.equal((await runCandidateAiWork(test.pool,refreshId,'niche_analysis',{transport,encryptionKey:key})).kind,'already_handled','Excluded private fields must not trigger another analysis');
 await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,reason) VALUES($1,'top_price','unknown','Original input restored')",[refreshId]);
 assert.equal((await runCandidateAiWork(test.pool,refreshId,'niche_analysis',{transport,encryptionKey:key})).kind,'already_handled','Returning to an identical prior input must reuse its completed operation');
 const restoredView=(await test.call(`/api/candidates/${refreshId}/ai-analysis`)).body;
 assert.equal(restoredView.tasks.length,1);assert.equal(restoredView.tasks[0].id,oldTask.id);
 await assert.rejects(test.pool.query("UPDATE ai_business_tasks SET input_hash=decode(repeat('00',32),'hex') WHERE id=$1",[oldTask.id]),/immutable/);
 const movingId=await candidate('evidence-during-analysis');
 await runCandidateAiWork(test.pool,movingId,'niche_analysis',{encryptionKey:key,transport:{kind:'ready',send:async input=>{
  await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,value_numeric,source_id,observed_at) VALUES($1,'top_price','measured',30,'synthetic-arrived-during-analysis',now())",[movingId]);
  return response(input);
 }}});
 assert.equal((await test.call(`/api/candidates/${movingId}/ai-analysis`)).body.tasks.length,0,'Evidence changed during analysis must hide its result');
 assert.equal((await test.pool.query('SELECT state FROM ai_business_tasks WHERE candidate_id=$1',[movingId])).rows[0].state,'stale');
 assert.equal((await runCandidateAiWork(test.pool,movingId,'niche_analysis',{transport,encryptionKey:key})).kind,'succeeded');
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM evidence WHERE candidate_id=$1',[id])).rows[0].n,before);
 assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[id])).rows[0].stage,'sourcing');
 await assert.rejects(test.pool.query("UPDATE ai_business_tasks SET input_payload='{}' WHERE candidate_id=$1",[id]),/immutable/);
 const staleId=await candidate('stale');
 const staleTransport={kind:'ready',send:async input=>{await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[staleId]);return response(input);}};
 await runCandidateAiWork(test.pool,staleId,'niche_analysis',{transport:staleTransport,encryptionKey:key});
 assert.equal((await test.pool.query('SELECT state FROM ai_business_tasks WHERE candidate_id=$1',[staleId])).rows[0].state,'stale');assert.equal((await test.call(`/api/candidates/${staleId}/ai-analysis`)).body.tasks.length,0);
 const badId=await candidate('forged');await runCandidateAiWork(test.pool,badId,'niche_analysis',{encryptionKey:key,transport:{kind:'ready',send:async input=>response(input,{suggestions:[{text:'Forged',sourceRefs:['not-provided']}]})}});assert.equal((await test.call(`/api/candidates/${badId}/ai-analysis`)).body.tasks[0].result,null);
 const echoId=await candidate('echo');await runCandidateAiWork(test.pool,echoId,'niche_analysis',{encryptionKey:key,transport:{kind:'ready',send:async input=>response(input,{summary:input.apiKey})}});const echoView=await test.call(`/api/candidates/${echoId}/ai-analysis`);assert.equal(echoView.body.tasks[0].result,null);assert.ok(!JSON.stringify(echoView.body).includes('SYNTHETIC_"BUSINESS_KEY_7392'));
 const changedSettingsId=await candidate('settings-change');await runCandidateAiWork(test.pool,changedSettingsId,'niche_analysis',{encryptionKey:key,transport:{kind:'ready',send:async input=>{await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'synthetic-version-change',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1");return response(input);}}});assert.equal((await test.pool.query('SELECT state FROM ai_business_tasks WHERE candidate_id=$1',[changedSettingsId])).rows[0].state,'stale');assert.equal((await test.call(`/api/candidates/${changedSettingsId}/ai-analysis`)).body.tasks.length,0);
 const pipelineId=await candidate('pipeline');await advanceCandidate(test.pool,resolveTransport({JS_TRANSPORT:'disabled'}),{candidateId:pipelineId,stage:'sourcing',inputVersion:1},{transport,encryptionKey:key});assert.deepEqual((await test.call(`/api/candidates/${pipelineId}/ai-analysis`)).body.tasks.map(task=>task.role).sort(),['niche_analysis','sourcing_analysis']);
 const importedId=await candidate('imported');await test.pool.query("UPDATE candidates SET stage='imported' WHERE id=$1",[importedId]);await advanceCandidate(test.pool,resolveTransport({JS_TRANSPORT:'disabled'}),{candidateId:importedId,stage:'imported',inputVersion:1},{transport,encryptionKey:key});assert.deepEqual((await test.call(`/api/candidates/${importedId}/ai-analysis`)).body.tasks.map(task=>task.role).sort(),['niche_analysis','normalize']);
 const rfqId=await candidate('rfq');await test.pool.query("UPDATE candidates SET stage='rfq_draft' WHERE id=$1",[rfqId]);await advanceCandidate(test.pool,resolveTransport({JS_TRANSPORT:'disabled'}),{candidateId:rfqId,stage:'rfq_draft',inputVersion:1},{transport,encryptionKey:key});assert.equal((await test.call(`/api/candidates/${rfqId}/ai-analysis`)).body.tasks[0].result.role,'rfq_draft');
 const specId=await candidate('spec');
 async function addSpec(revision){await test.pool.query("INSERT INTO spec_revisions(candidate_id,revision,material,dimensions,packaging,requirements,requested_quantity,source) VALUES($1,$2,'silicone','30 cm','PRIVATE_EMAIL_SENTINEL@example.invalid','PRIVATE_REQUIREMENTS_SENTINEL',300,'synthetic')",[specId,revision]);}
 await addSpec(1);
 await runCandidateAiWork(test.pool,specId,'rfq_draft',{encryptionKey:key,transport:{kind:'ready',send:async input=>{const request=JSON.parse(input.messages[1].content);assert.equal(request.spec.material,'silicone');assert.equal(request.spec.requestedQuantity,300);assert.equal(request.spec.packaging,null);assert.ok(!JSON.stringify(request).includes('PRIVATE_REQUIREMENTS_SENTINEL'));await addSpec(2);return response(input);}}});
 assert.equal((await test.pool.query('SELECT state FROM ai_business_tasks WHERE candidate_id=$1',[specId])).rows[0].state,'stale');assert.equal((await test.call(`/api/candidates/${specId}/ai-analysis`)).body.tasks.length,0);
 await runCandidateAiWork(test.pool,specId,'rfq_draft',{transport,encryptionKey:key});assert.equal((await test.call(`/api/candidates/${specId}/ai-analysis`)).body.tasks.length,1);
 const disabledId=await candidate('disabled');assert.equal((await runCandidateAiWork(test.pool,disabledId,'niche_analysis',{transport:{kind:'disabled'},encryptionKey:key})).kind,'disabled');assert.equal((await test.call(`/api/candidates/${disabledId}/ai-analysis`)).body.tasks.length,0);
 const routes=new Map();
 for(const [role,label] of [['normalize','A'],['rfq_draft','B']]){
  const config={version:0,name:'Routing '+label,model:'routing-'+label,baseUrl:'https://routing-'+label.toLowerCase()+'.fixture.invalid/v1',apiKey:'SYNTHETIC_ROUTING_'+label+'_7392',dailyBudgetUsd:'2.00',roles:[role],priority:0,inputUsdPerMillion:'1',outputUsdPerMillion:'2',maxInputTokens:4096,maxOutputTokens:1024};
  const stored=await test.call('/api/custom-ai',config);assert.equal(stored.status,201);
  const activation=await test.call(`/api/custom-ai/${stored.body.profile.id}/activation-proposals`,{version:1});assert.equal((await test.call(`/api/approvals/${activation.body.approvalId}/approve`,{})).status,200);
  const seen=[];
  const server=createServer(async(req,res)=>{
   try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer '+config.apiKey);assert.equal(input.model,config.model);assert.equal(JSON.parse(input.messages[1].content).role,role);
    seen.push(input.model);res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(response(input,{summary:'Verified route '+label}).body));
   }catch{res.writeHead(500).end('{}');}
  });localServers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  routes.set(config.baseUrl,{url:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,role,label,profileId:stored.body.profile.id,seen});
 }
 const routedTransport={kind:'ready',send:async input=>{const route=routes.get(input.baseUrl);assert.ok(route,'Only configured local fixture routes may run');const reply=await fetch(route.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+input.apiKey},body:JSON.stringify({model:input.model,messages:input.messages}),redirect:'error',signal:AbortSignal.timeout(5000)});return {kind:'response',status:reply.status,body:await reply.json()};}};
 const routedId=await candidate('two-endpoint-routing');
 for(const route of routes.values()){
  const routed=await runCandidateAiWork(test.pool,routedId,route.role,{transport:routedTransport,encryptionKey:key});assert.equal(routed.kind,'succeeded');assert.equal(routed.profileId,route.profileId);assert.equal(route.seen.length,1);
 }
 const routedView=(await test.call(`/api/candidates/${routedId}/ai-analysis`)).body.tasks;
 assert.equal(routedView.find(task=>task.role==='normalize').result.summary,'Verified route A');assert.equal(routedView.find(task=>task.role==='rfq_draft').result.summary,'Verified route B');
 const proposedId=await candidate('automatic-spec');
 const proposedVersion=(await test.pool.query('SELECT max(version)::int AS v FROM settings_versions')).rows[0].v;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[proposedId,proposedVersion,JSON.stringify({synthetic:true,inputVersion:1})]);
 const target={material:'Proposed silicone',dimensions:'Proposed 30 cm',packaging:'Individual box',requirements:'Supplier must confirm the target before quoting',requestedQuantity:300,rationale:'Comparison target only, not a measured product',sourceRefs:['subject']};
 let proposalCalls=0;
 const proposingTransport={kind:'ready',send:async input=>{proposalCalls++;return response(input,{targetSpecification:target});}};
 await runCandidateAiWork(test.pool,proposedId,'sourcing_analysis',{transport:proposingTransport,encryptionKey:key});
 const proposedSpecs=(await test.call(`/api/candidates/${proposedId}/sourcing`)).body.specs;
 assert.equal(proposedSpecs.length,1,'A successful current AI target should create the first proposed spec');
 assert.equal(proposedSpecs[0].material,target.material);assert.ok(proposedSpecs[0].aiTaskId);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM evidence WHERE candidate_id=$1',[proposedId])).rows[0].n,0,'A proposed target must not create measured evidence');
 assert.equal((await test.call(`/api/candidates/${proposedId}/ai-analysis`)).body.tasks.length,1,'The proposal source remains visible after materialization');
 assert.equal((await runCandidateAiWork(test.pool,proposedId,'sourcing_analysis',{transport:proposingTransport,encryptionKey:key})).kind,'already_handled');
 assert.equal(proposalCalls,1,'Creating its own spec must not cause a second model request');
 assert.equal((await test.call(`/api/candidates/${proposedId}/sourcing`)).body.specs.length,1);
 async function storedTarget(label,validated=true,finish=true){
  const candidateId=await candidate(label),version=(await test.pool.query('SELECT max(version)::int AS v FROM settings_versions')).rows[0].v;
  if(validated)await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[candidateId,version,JSON.stringify({synthetic:true,inputVersion:1})]);
  const task=await prepareCandidateAiTask(test.pool,candidateId,'sourcing_analysis');assert.ok(task);
  assert.equal((await executeApprovedAiBusiness(test.pool,{operationId:task.id,businessInput:task.input,encryptionKey:key,createTransport:()=>proposingTransport})).kind,'succeeded');
  if(finish)await finishCandidateAiTask(test.pool,task.id);
  return {candidateId,taskId:task.id,version};
 }
 const concurrent=await storedTarget('concurrent-target');
 const results=await Promise.all([materializeProposedSpec(test.pool,concurrent.taskId),materializeProposedSpec(test.pool,concurrent.taskId),materializeProposedSpec(test.pool,concurrent.taskId)]);
 assert.equal(results.filter(result=>result.kind==='created').length,1);
 assert.equal(new Set(results.map(result=>result.specId)).size,1);
 const manual=await storedTarget('manual-target-race');
 const operator={material:'Operator steel',dimensions:'Operator 20 cm',packaging:'Operator box',requirements:'Operator comparison target',requestedQuantity:100,source:'Operator fixture'};
 const manualResults=await Promise.all([materializeProposedSpec(test.pool,manual.taskId),test.call(`/api/candidates/${manual.candidateId}/specs`,operator)]);
 assert.equal(manualResults[1].status,201);
 const manualSpecs=(await test.call(`/api/candidates/${manual.candidateId}/sourcing`)).body.specs;
 assert.equal(manualSpecs[0].material,operator.material);assert.equal(manualSpecs[0].aiTaskId,null);
 const unvalidated=await storedTarget('no-validation',false);assert.equal((await materializeProposedSpec(test.pool,unvalidated.taskId)).kind,'not_ready');
 const held=await storedTarget('latest-hold');
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','hold',$3::jsonb)",[held.candidateId,held.version,JSON.stringify({synthetic:true,inputVersion:1})]);
 assert.equal((await materializeProposedSpec(test.pool,held.taskId)).kind,'not_ready');
 const changedInput=await storedTarget('changed-input');
 await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[changedInput.candidateId]);
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[changedInput.candidateId,changedInput.version,JSON.stringify({synthetic:true,inputVersion:2})]);
 assert.equal((await materializeProposedSpec(test.pool,changedInput.taskId)).kind,'not_ready');
 const recovering=await storedTarget('recover-before-finish',true,false);
 await recoverProposedSpecs(test.pool);
 assert.equal((await test.call(`/api/candidates/${recovering.candidateId}/sourcing`)).body.specs[0].aiTaskId,recovering.taskId);
 assert.equal((await test.call(`/api/candidates/${held.candidateId}/sourcing`)).body.specs.length,0);
 const changedCriteria=await storedTarget('changed-criteria');
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'synthetic-target-change',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1");
 const versionAfter=(await test.pool.query('SELECT max(version)::int AS v FROM settings_versions')).rows[0].v;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[changedCriteria.candidateId,versionAfter,JSON.stringify({synthetic:true,inputVersion:1})]);
 assert.equal((await materializeProposedSpec(test.pool,changedCriteria.taskId)).kind,'not_ready');
 await assert.rejects(test.pool.query("INSERT INTO spec_revisions(candidate_id,revision,material,dimensions,packaging,requirements,requested_quantity,source,ai_task_id) VALUES($1,1,'x','x','x','x',1,'synthetic',$2)",[unvalidated.candidateId,changedCriteria.taskId]),error=>error.code==='23503');
 await assert.rejects(test.pool.query("INSERT INTO spec_revisions(candidate_id,revision,material,dimensions,packaging,requirements,requested_quantity,source,ai_task_id) VALUES($1,2,'x','x','x','x',1,'synthetic',$2)",[held.candidateId,held.taskId]),error=>error.code==='23514');
 const startupTarget=await storedTarget('worker-startup-recovery',true,false);
 const operationsBefore=(await test.pool.query('SELECT count(*)::int AS n FROM ai_execution_operations')).rows[0].n;
 const worker=spawn(process.execPath,['--import','tsx','apps/worker/src/index.ts'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,APP_ENV:'development',DATABASE_URL:test.databaseUrl,ENCRYPTION_KEY:key.toString('hex'),AI_TRANSPORT:'disabled',JS_TRANSPORT:'disabled',MAIL_TRANSPORT:'disabled',BROWSER_TASKS_ENABLED:'false',BROWSER_SIGNING_KEY_FILE:''}});
 const workerClosed=once(worker,'close');worker.stdout.resume();worker.stderr.resume();
 try{
  let recovered=false;
  for(let attempt=0;attempt<100;attempt++){recovered=(await test.pool.query('SELECT count(*)::int AS n FROM spec_revisions WHERE candidate_id=$1 AND ai_task_id=$2',[startupTarget.candidateId,startupTarget.taskId])).rows[0].n===1;if(recovered)break;if(worker.exitCode!==null)throw new Error('RECOVERY_WORKER_EXITED');await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(recovered,true,'The actual worker startup must recover the stored proposal');
  assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM ai_execution_operations')).rows[0].n,operationsBefore,'Recovery must not create another model operation');
 }finally{worker.kill();await workerClosed;}
 console.log(JSON.stringify({scenario:'automatic-specification',result:'PASS',initialProposalOnly:true,noExtraModelCall:true,sourceVisible:true,noMeasuredEvidenceCreated:true,concurrentOnce:true,operatorWins:true,latestValidationRequired:true,inputAndSettingsFenced:true,recoveryFromStoredResult:true,actualWorkerRecovery:true,realProviderCalls:0}));
 console.log(JSON.stringify({scenario:'provider-role-routing',result:'PASS',localHttpEndpoints:routes.size,requests:[...routes.values()].map(route=>({role:route.role,count:route.seen.length})),roleResultsDistinct:true}));
 console.log(JSON.stringify({scenario:'ai-business',result:'PASS',roles:4,privacyFiltered:true,unknownPreserved:true,forgedRefsBlocked:true,secretEchoBlocked:true,versionGuard:true,settingsVersionGuard:true,specVersionGuard:true,specPrivacyFiltered:true,idempotent:true,immutableInputs:true,deterministicEvidenceUnchanged:true,workerPipelineConnected:true,realProviderCalls:0}));
}finally{await Promise.all(localServers.map(server=>new Promise(resolve=>server.close(resolve))));await test.close();}
for(const materialize of [true,false]){
 const grounded=await openAcceptance({databaseKey:'grounded-proposal-'+materialize+'-'+Date.now()});
 try{
  const fixture=await groundedProposalFixture(grounded,{materialize});
  const before=(await grounded.pool.query('SELECT count(*)::int n FROM ai_execution_operations')).rows[0].n;
  if(!materialize){await recoverProposedSpecs(grounded.pool);await recoverProposedSpecs(grounded.pool);}
  const specs=(await grounded.call('/api/candidates/'+fixture.candidateId+'/sourcing')).body.specs;
  assert.equal(specs.length,1);assert.equal(specs[0].aiTaskId,fixture.aiTaskId);assert.equal(specs[0].requirements,fixture.target.requirements);
  assert.equal((await grounded.pool.query('SELECT count(*)::int n FROM ai_execution_operations')).rows[0].n,before);
  console.log(JSON.stringify({scenario:materialize?'grounded-proposal-handoff':'grounded-proposal-recovery',result:'PASS',modelCalls:fixture.calls,seededMarketValidation:true,externalCalls:0}));
 }finally{await grounded.close();}
}
