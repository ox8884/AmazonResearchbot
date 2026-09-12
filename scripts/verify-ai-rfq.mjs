import { createContactCycle } from '../apps/worker/src/contact-loop.ts';
import { prepareAutomaticRfqs, prepareReadyRfqs } from '../apps/worker/src/automatic-rfq.ts';
import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {runCandidateAiWork} from '../apps/worker/src/ai-business.ts';
import {dispatchContact} from '../apps/worker/src/contact-runner.ts';
const key=Buffer.from('43'.repeat(32),'hex');
const test=await openAcceptance({databaseKey:'ai-rfq-'+Date.now(),encryptionKeyHex:key.toString('hex')});
let sent=0;
const aiTransport={kind:'ready',send:async()=>({kind:'response',status:200,body:{choices:[{message:{content:JSON.stringify({role:'rfq_draft',summary:'RFQ wording',suggestions:[{text:'Confirm lead time',sourceRefs:['spec']}],draftText:'Hello, please confirm lead time and available colors.'})}}]}})};
const specInput={material:'silicone',dimensions:'30 cm',packaging:'single pack',requirements:'Food contact compliance evidence required',requestedQuantity:300,source:'synthetic fixture'};
async function setup(label){
 const id=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",['spatula '+label+' '+test.runId])).rows[0].id;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation','pass','{\"synthetic\":true,\"inputVersion\":1}')",[id]);
 const spec=(await test.call(`/api/candidates/${id}/specs`,specInput)).body;
 const supplier=(await test.call(`/api/candidates/${id}/suppliers`,{name:'Synthetic supplier',email:'supplier@fixture.invalid',source:'synthetic',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Matched synthetic specification'})).body;
 assert.equal((await runCandidateAiWork(test.pool,id,'rfq_draft',{transport:aiTransport,encryptionKey:key})).kind,'succeeded');
 const preview=(await test.call(`/api/candidates/${id}/rfq-ai?specId=${spec.id}&quantity=300`)).body.suggestion;assert.ok(preview);
 return {id,spec,supplier,preview,input:{supplierId:supplier.id,specId:spec.id,quantity:300,...preview}};
}
async function approve(draft){const proposal=await test.call(`/api/rfqs/${draft.id}/approval`,{});assert.equal(proposal.status,201);assert.equal((await test.call(`/api/approvals/${proposal.body.approvalId}/approve`,{})).status,200);return (await test.pool.query('SELECT id FROM external_actions WHERE approval_id=$1',[proposal.body.approvalId])).rows[0].id;}
try{
 const provider=await test.call('/api/custom-ai',{version:0,name:'RFQ fixture',model:'fixture',baseUrl:'https://model.fixture.invalid/v1',apiKey:'SYNTHETIC_RFQ_KEY',dailyBudgetUsd:'2.00',roles:['rfq_draft'],priority:1,inputUsdPerMillion:'1',outputUsdPerMillion:'2',maxInputTokens:4096,maxOutputTokens:1024});
 const grant=await test.call(`/api/custom-ai/${provider.body.profile.id}/activation-proposals`,{version:1});assert.equal((await test.call(`/api/approvals/${grant.body.approvalId}/approve`,{})).status,200);
 const auto=await setup('automatic');
 assert.equal(await prepareAutomaticRfqs(test.pool,auto.id),0,'Unbound supplier match must not automatically prepare contact');
 for(const label of ['one','two','one']){
  const bound=await test.call(`/api/candidates/${auto.id}/suppliers`,{specId:auto.spec.id,name:'Synthetic auto '+label,email:label+'@fixture.invalid',source:'synthetic sourced contact',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Matched to this exact synthetic specification'});assert.equal(bound.status,201);
 }
 const generated=await Promise.all([prepareAutomaticRfqs(test.pool,auto.id),prepareAutomaticRfqs(test.pool,auto.id)]);assert.equal(generated.reduce((a,b)=>a+b,0),2);
 const autoWorkspace=(await test.call(`/api/candidates/${auto.id}/contact`)).body;
 assert.deepEqual(autoWorkspace.drafts.map(r=>r.recipient).sort(),['one@fixture.invalid','two@fixture.invalid'],'Automatic AI drafts must use exactly the sourced recipients');
 assert.equal(autoWorkspace.drafts.length,2);assert.ok(autoWorkspace.drafts.every(r=>r.state==='pending_approval'&&r.approvalId&&r.aiTaskId===auto.preview.aiTaskId&&r.body===auto.preview.body));
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM external_actions a JOIN rfq_drafts r ON r.id=a.rfq_id WHERE r.candidate_id=$1',[auto.id])).rows[0].n,0);
 for(const draft of autoWorkspace.drafts)assert.equal((await test.call(`/api/approvals/${draft.approvalId}/reject`,{})).status,200);
 assert.equal(await prepareAutomaticRfqs(test.pool,auto.id),0,'Rejected requests must not be recreated by a background tick');
 await test.call(`/api/candidates/${auto.id}/specs`,{...specInput,dimensions:'44 cm'});
 assert.equal(await prepareAutomaticRfqs(test.pool,auto.id),0,'A previous specification match must not transfer to new specifications');
 const latestSpec=(await test.call(`/api/candidates/${auto.id}/sourcing`)).body.specs[0];
 for(const [status,email] of [['unknown','unknown@fixture.invalid'],['mismatch','mismatch@fixture.invalid'],['matches',null],['matches','template@fixture.invalid']]){
  assert.equal((await test.call(`/api/candidates/${auto.id}/suppliers`,{specId:latestSpec.id,name:'Synthetic template supplier',email,source:'synthetic source',observedAt:new Date().toISOString(),matchStatus:status,matchNotes:'Synthetic observation for exact spec'})).status,201);
 }
 await test.pool.query(`CREATE FUNCTION reject_auto_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.candidate_id='${auto.id}'::uuid THEN RAISE EXCEPTION 'synthetic approval fault'; END IF; RETURN NEW; END $$`);
 await test.pool.query('CREATE TRIGGER reject_auto_fixture BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION reject_auto_fixture()');
 await assert.rejects(prepareAutomaticRfqs(test.pool,auto.id),/synthetic approval fault/);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM rfq_drafts WHERE candidate_id=$1',[auto.id])).rows[0].n,2,'Failed pending approval must not leave an orphan draft');
 await test.pool.query('DROP TRIGGER reject_auto_fixture ON approvals');await test.pool.query('DROP FUNCTION reject_auto_fixture()');
 await prepareReadyRfqs(test.pool);
 await createContactCycle(test.pool,null)();
 const fallback=(await test.call(`/api/candidates/${auto.id}/contact`)).body.drafts.find(r=>r.specId===latestSpec.id);
 assert.ok(fallback);assert.equal(fallback.aiTaskId,null);assert.equal(fallback.state,'pending_approval');assert.equal(fallback.recipient,'template@fixture.invalid');assert.ok(fallback.body.includes('Dimensions and units: 44 cm'));
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM external_actions a JOIN rfq_drafts r ON r.id=a.rfq_id WHERE r.candidate_id=$1',[auto.id])).rows[0].n,0);
 await test.call(`/api/candidates/${auto.id}/specs`,{...specInput,dimensions:'45 cm'});
 assert.equal((await test.call(`/api/approvals/${fallback.approvalId}/approve`,{})).status,409,'Fixed-template approval must reject stale supplier specification');
 const freshSpec=(await test.call(`/api/candidates/${auto.id}/sourcing`)).body.specs[0];
 assert.equal((await test.call(`/api/candidates/${auto.id}/suppliers`,{specId:freshSpec.id,name:'Synthetic race',email:'race@fixture.invalid',source:'synthetic source',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Exact current specification'})).status,201);
 assert.equal(await prepareAutomaticRfqs(test.pool,auto.id),1);
 const fixedRace=(await test.call(`/api/candidates/${auto.id}/contact`)).body.drafts.find(r=>r.specId===freshSpec.id);
 assert.equal((await test.call(`/api/approvals/${fixedRace.approvalId}/approve`,{})).status,200);
 const fixedAction=(await test.pool.query('SELECT id FROM external_actions WHERE rfq_id=$1',[fixedRace.id])).rows[0].id;
 let fixedSends=0;
 const fixedResult=await dispatchContact(test.pool,fixedAction,{name:'synthetic fixed race',authorize:async()=>{await test.call(`/api/candidates/${auto.id}/specs`,{...specInput,dimensions:'46 cm'});return {allowed:true};},send:async()=>{fixedSends++;return {kind:'unknown',reason:'unexpected send'};}});
 assert.equal(fixedResult,'skipped');assert.equal(fixedSends,0,'Spec change during preflight must stop fixed-template contact');
 const valid=await setup('valid');
 assert.equal((await test.call(`/api/candidates/${auto.id}/suppliers`,{specId:valid.spec.id,name:'Wrong candidate spec',email:'wrong@fixture.invalid',source:'synthetic',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'synthetic'})).status,404);
 await assert.rejects(test.pool.query('UPDATE sourcing_suppliers SET spec_id=$2 WHERE id=$1',[auto.supplier.id,auto.spec.id]),/immutable/,'Legacy source must not be relabeled automatically');
assert.ok(valid.preview.body.includes(specInput.requirements));assert.ok(valid.preview.body.includes('Requested quantity: 300'));assert.ok(valid.preview.body.includes('Product unit price (USD):'));
 const edited={...valid.input,body:valid.input.body+' Additional color samples requested.'};
 const saved=await test.call(`/api/candidates/${valid.id}/rfqs`,edited);assert.equal(saved.status,201);assert.equal(saved.body.aiTaskId,valid.preview.aiTaskId);
 assert.equal((await test.call(`/api/candidates/${valid.id}/rfqs`,edited)).body.id,saved.body.id);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM external_actions WHERE rfq_id=$1',[saved.body.id])).rows[0].n,0);
 await assert.rejects(test.pool.query('UPDATE rfq_drafts SET ai_task_id=NULL WHERE id=$1',[saved.body.id]),/immutable/);
 assert.equal((await test.call(`/api/candidates/${valid.id}/rfqs`,{...edited,quantity:301})).body.code,'AI_RFQ_STALE');
 const action=await approve(saved.body);
 const mail={name:'synthetic',authorize:async()=>({allowed:true}),send:async payload=>{sent++;assert.equal(payload.body,edited.body);assert.equal(payload.recipient,'supplier@fixture.invalid');return {kind:'sent',messageId:'fixture',receipt:'synthetic accepted'};}};
 assert.equal(await dispatchContact(test.pool,action,mail),'sent');assert.equal(await dispatchContact(test.pool,action,mail),'skipped');assert.equal(sent,1);
 const old=await setup('old-spec');await test.call(`/api/candidates/${old.id}/specs`,{...specInput,dimensions:'32 cm'});assert.equal((await test.call(`/api/candidates/${old.id}/rfqs`,old.input)).body.code,'AI_RFQ_STALE');
 const before=await setup('before-approval');const beforeDraft=(await test.call(`/api/candidates/${before.id}/rfqs`,before.input)).body;await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[before.id]);assert.equal((await test.call(`/api/rfqs/${beforeDraft.id}/approval`,{})).body.code,'AI_RFQ_STALE');
 const race=await setup('race');const raceDraft=(await test.call(`/api/candidates/${race.id}/rfqs`,race.input)).body;const raceAction=await approve(raceDraft);
 const raceMail={...mail,authorize:async()=>{await test.call(`/api/candidates/${race.id}/specs`,{...specInput,dimensions:'35 cm'});return {allowed:true};}};
 assert.equal(await dispatchContact(test.pool,raceAction,raceMail),'skipped');assert.equal(sent,1);assert.equal((await test.pool.query('SELECT state FROM external_actions WHERE id=$1',[raceAction])).rows[0].state,'cancelled');
 const invalidBacklog=[];
 async function queueable(label,hold){
  const item=await setup(label);
  assert.equal((await test.call(`/api/candidates/${item.id}/suppliers`,{specId:item.spec.id,name:'Synthetic batch '+label,email:label+'@fixture.invalid',source:'synthetic exact source',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Synthetic exact specification'})).status,201);
  if(hold)await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation','hold','{\"synthetic\":true,\"inputVersion\":1}'::jsonb)",[item.id]);
  return item;
 }
 for(let n=0;n<21;n++)invalidBacklog.push(await queueable('old-pass-'+n,true));
 const readyAfterBacklog=await queueable('current-pass',false);
 await prepareReadyRfqs(test.pool);
 assert.equal((await test.call(`/api/candidates/${readyAfterBacklog.id}/contact`)).body.drafts.length,1,'Invalid old-pass backlog must not starve a current valid candidate');
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM rfq_drafts WHERE candidate_id=ANY($1::uuid[])',[invalidBacklog.map(item=>item.id)])).rows[0].n,0,'Latest hold forbids automatic RFQ preparation');
 console.log(JSON.stringify({scenario:'ai-rfq',result:'PASS',automaticTwoPending:true,latestValidationRequired:true,invalidBacklogDoesNotStarve:true,automaticRecipientDedup:true,rejectedNotRecreated:true,fixedTemplateFallback:true,atomicProposalFailure:true,groundedTemplate:true,editedBodyPreserved:true,sourceImmutable:true,approvalRequired:true,staleSaveBlocked:true,staleApprovalBlocked:true,preflightRaceBlocked:true,duplicatesBlocked:true,realModelCalls:0,realEmails:0}));
}finally{await test.close();}
