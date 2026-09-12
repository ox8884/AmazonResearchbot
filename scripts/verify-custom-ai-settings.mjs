import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {openAcceptance} from './support/acceptance.mjs';

const test=await openAcceptance({databaseKey:'custom-ai-settings-'+Date.now()});
try {
 // Given a pre-0024 encrypted profile, when 0024 is applied in an isolated schema, then its ciphertext remains usable by key revision.
 const legacy=test.pool.connect();
 const schema=`legacy_custom_ai_${test.runId}`;
 const legacyClient=await legacy;
 try {
  await legacyClient.query('BEGIN');await legacyClient.query(`CREATE SCHEMA ${schema}`);await legacyClient.query(`SET LOCAL search_path TO ${schema}`);
  await legacyClient.query(await readFile(new URL('../packages/db/sql/0015_custom_ai_profiles.sql',import.meta.url),'utf8'));
  const legacyCiphertext='legacy-encrypted-fixture';
  await legacyClient.query("INSERT INTO custom_ai_profiles(id,name,base_url,model,daily_budget_usd,api_key_ciphertext,api_key_last4,status,version) VALUES($1,'Legacy','https://legacy.fixture.invalid/v1','legacy-model',2.00,$2,'1234','draft',1)",[randomUUID(),legacyCiphertext]);
  await legacyClient.query(await readFile(new URL('../packages/db/sql/0024_ai_provider_activation.sql',import.meta.url),'utf8'));
  const legacyRow=await legacyClient.query('SELECT api_key_ciphertext,key_revision FROM custom_ai_profiles');assert.equal(legacyRow.rows[0].api_key_ciphertext,legacyCiphertext);assert.equal(legacyRow.rows[0].key_revision,1);
 } finally {await legacyClient.query('ROLLBACK');legacyClient.release();}

 const profile={
  name:'Synthetic custom AI',baseUrl:'https://model.fixture.invalid/v1',model:'fixture-model',
  apiKey:'SYNTHETIC_PRIVATE_KEY_7392',dailyBudgetUsd:'2.00',version:0,
  roles:['normalize','rfq_draft'],priority:75,inputUsdPerMillion:'0.150000',
  outputUsdPerMillion:'0.600000',maxInputTokens:4096,maxOutputTokens:512,
  retentionPolicyUrl:'https://model.fixture.invalid/privacy',
 };

 // Given two isolated custom providers, when saved, then roles and defaults are safe views.
 const saved=await test.call('/api/custom-ai',profile);assert.equal(saved.status,201);
 const second=await test.call('/api/custom-ai',{name:'Defaults provider',baseUrl:'https://defaults.fixture.invalid/v1',model:'defaults-model',apiKey:'',dailyBudgetUsd:'0',version:0});assert.equal(second.status,201);
 assert.equal(saved.body.profile.hasKey,true);assert.equal(saved.body.profile.status,'draft');assert.deepEqual(saved.body.profile.roles,profile.roles);
 assert.equal(saved.body.profile.protocol,'openai_chat_completions');assert.equal(second.body.profile.priority,0);
 assert.deepEqual(second.body.profile.roles,[]);assert.equal(second.body.profile.inputUsdPerMillion,null);
 assert.equal(second.body.profile.maxInputTokens,1024);assert.equal(second.body.profile.maxOutputTokens,256);
 assert.equal(second.body.profile.approvalId,null);assert.ok(!JSON.stringify(saved.body).includes(profile.apiKey));
 const listed=await test.call('/api/custom-ai');assert.equal(listed.body.profiles.length,2);assert.equal(listed.body.profiles[0].model,profile.model);
 const missingConfiguration=await test.call(`/api/custom-ai/${second.body.profile.id}/activation-proposals`,{version:1});assert.equal(missingConfiguration.status,400);assert.equal(missingConfiguration.body.code,'PROVIDER_CONFIG_REQUIRED');

 // Given an eligible configuration, when activation is proposed and then edited, then stale approval cannot activate it.
 const firstProposal=await test.call(`/api/custom-ai/${saved.body.profile.id}/activation-proposals`,{version:1});assert.equal(firstProposal.status,201);
 assert.equal(firstProposal.body.profile.status,'pending_approval');const persistedFirst=(await test.pool.query('SELECT id FROM approvals WHERE id=$1',[firstProposal.body.approvalId])).rows[0];assert.ok(persistedFirst);assert.equal(firstProposal.body.profile.approvalId,persistedFirst.id);
 const updated=await test.call('/api/custom-ai',{...profile,id:saved.body.profile.id,version:1,apiKey:'',model:'fixture-model-2'});assert.equal(updated.status,200);
 assert.equal(updated.body.profile.hasKey,true);assert.equal(updated.body.profile.status,'draft');assert.equal(updated.body.profile.approvalId,null);
 const stale=await test.call(`/api/approvals/${firstProposal.body.approvalId}/approve`,{});assert.equal(stale.status,409);assert.equal(stale.body.code,'APPROVAL_STALE');

 // Given the edited profile, when a fresh approval is accepted, then it becomes active and repeat approval is idempotent.
 const approvedProposal=await test.call(`/api/custom-ai/${saved.body.profile.id}/activation-proposals`,{version:2});assert.equal(approvedProposal.status,201);
 const approved=await test.call(`/api/approvals/${approvedProposal.body.approvalId}/approve`,{});assert.equal(approved.status,200);assert.equal(approved.body.status,'approved');
 const approvedAgain=await test.call(`/api/approvals/${approvedProposal.body.approvalId}/approve`,{});assert.equal(approvedAgain.status,200);assert.equal(approvedAgain.body.reused,true);
 const active=(await test.call('/api/custom-ai')).body.profiles.find((item)=>item.id===saved.body.profile.id);assert.equal(active.status,'active');assert.equal(active.approvalId,null);

 // Given an active profile, when edited, then the old approved record cannot reactivate the new draft.
 const activeEdit=await test.call('/api/custom-ai',{...profile,id:saved.body.profile.id,version:2,apiKey:'',model:'fixture-model-3'});assert.equal(activeEdit.status,200);assert.equal(activeEdit.body.profile.status,'draft');assert.equal(activeEdit.body.profile.version,3);
 const oldApproval=await test.call(`/api/approvals/${approvedProposal.body.approvalId}/approve`,{});assert.equal(oldApproval.status,200);assert.equal(oldApproval.body.reused,true);
 const draftAfterOldApproval=(await test.call('/api/custom-ai')).body.profiles.find((item)=>item.id===saved.body.profile.id);assert.equal(draftAfterOldApproval.status,'draft');
 const reapprovedProposal=await test.call(`/api/custom-ai/${saved.body.profile.id}/activation-proposals`,{version:3});assert.equal(reapprovedProposal.status,201);
 const persistedAgain=(await test.pool.query('SELECT id FROM approvals WHERE id=$1',[reapprovedProposal.body.approvalId])).rows[0];assert.ok(persistedAgain);assert.equal(reapprovedProposal.body.profile.approvalId,persistedAgain.id);
 assert.equal((await test.call(`/api/approvals/${reapprovedProposal.body.approvalId}/approve`,{})).status,200);

 // Given a newly reapproved profile, when disabled with its current optimistic version, then it is disabled and no activation remains linked.
 const disabled=await test.call(`/api/custom-ai/${saved.body.profile.id}/disable`,{version:3});assert.equal(disabled.status,200);assert.equal(disabled.body.profile.status,'disabled');assert.equal(disabled.body.profile.version,4);assert.equal(disabled.body.profile.approvalId,null);
 assert.equal((await test.call('/api/custom-ai',{...profile,id:saved.body.profile.id,version:2})).status,409);
 assert.equal((await test.call('/api/custom-ai',{...profile,baseUrl:'http://127.0.0.1:10100'})).status,400);
 assert.equal((await test.call('/api/custom-ai',{...profile,baseUrl:'https://user:secret@model.fixture.invalid/v1'})).status,400);
 assert.equal((await test.call('/api/custom-ai',{...profile,name:'Invalid retention provider',apiKey:'',retentionPolicyUrl:'https://user:fixture@model.fixture.invalid/privacy'})).status,400);
 assert.equal((await test.call('/api/custom-ai',profile,{origin:'https://wrong.invalid'})).status,403);

 // Given a disabled provider, an approved test grant authorizes only its named operation, not activation.
 const testProposal=await test.call(`/api/custom-ai/${saved.body.profile.id}/test-proposals`,{version:4,role:'normalize'});assert.equal(testProposal.status,201);
 assert.equal(testProposal.body.payload.purpose,'test');assert.equal(testProposal.body.payload.maxCostUsd,'0.000922');
 const repeatedTest=await test.call(`/api/custom-ai/${saved.body.profile.id}/test-proposals`,{version:4,role:'normalize'});assert.equal(repeatedTest.status,200);assert.equal(repeatedTest.body.approvalId,testProposal.body.approvalId);assert.equal(repeatedTest.body.payload.operationId,testProposal.body.payload.operationId);
 assert.equal((await test.call(`/api/approvals/${testProposal.body.approvalId}/approve`,{})).status,200);
 const disabledTransport=await test.call(`/api/custom-ai/${saved.body.profile.id}/tests/${testProposal.body.approvalId}/run`,{});assert.equal(disabledTransport.status,409);assert.equal(disabledTransport.body.code,'AI_TRANSPORT_DISABLED');
 const afterTestApproval=(await test.call('/api/custom-ai')).body.profiles.find(p=>p.id===saved.body.profile.id);assert.equal(afterTestApproval.status,'disabled');assert.equal(afterTestApproval.version,4);
 const testList=await test.call(`/api/custom-ai/${saved.body.profile.id}/tests`);assert.equal(testList.status,200);assert.equal(testList.body.tests[0].status,'approved');
 assert.equal((await test.call(`/api/custom-ai/${saved.body.profile.id}/test-proposals`,{version:4,role:'niche_analysis'})).status,400);
 const staleTest=await test.call(`/api/custom-ai/${saved.body.profile.id}/test-proposals`,{version:4,role:'rfq_draft'});assert.equal(staleTest.status,201);
 assert.equal((await test.call('/api/custom-ai',{...profile,id:saved.body.profile.id,version:4,apiKey:'',model:'fixture-model-4'})).status,200);
 assert.equal((await test.call(`/api/approvals/${staleTest.body.approvalId}/approve`,{})).status,409);
 // Then neither safe responses nor persisted approval/audit JSON contain the synthetic secret, and no API attempt exists.
 const rows=await test.pool.query('SELECT api_key_ciphertext FROM custom_ai_profiles');const ciphertexts=rows.rows.map((row)=>row.api_key_ciphertext).filter((value)=>value!==null);assert.equal(ciphertexts.length,1);assert.ok(!ciphertexts[0].includes(profile.apiKey));
 const stored=await test.pool.query("SELECT payload::text AS value FROM approvals UNION ALL SELECT meta::text AS value FROM audit_events");assert.ok(stored.rows.every((row)=>!row.value.includes(profile.apiKey)));
 const attempts=await test.pool.query('SELECT count(*)::int AS count FROM api_attempts');assert.equal(attempts.rows[0].count,0);
 console.log(JSON.stringify({scenario:'custom-ai-settings-lifecycle',result:'PASS',profiles:2,rolesPersisted:true,legacyKeyBackfill:true,testGrantScoped:true,testGrantStaleBlocked:true,retentionUrlBlocked:true,staleApprovalBlocked:true,repeatedApprovalIdempotent:true,activeEditInvalidated:true,activationApproved:true,disabled:true,writeOnlyKey:true,externalCalls:0}));
} finally {await test.close();}
