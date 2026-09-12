import assert from 'node:assert/strict';
import {approvedRfq} from './support/approved-rfq.mjs';
import { openAcceptance } from './support/acceptance.mjs';
import { rfqTemplate } from '../packages/domain/src/rfq.ts';
import { dispatchContact,recoverContactOutcomes } from '../apps/worker/src/contact-runner.ts';
import { createMailpitTransport } from '../packages/integrations/src/mail/mailpit.ts';
const test=await openAcceptance();
try {
  const settings=(await test.call('/api/settings')).body;
  const result=await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",['QA RFQ '+test.runId]);const candidateId=result.rows[0].id;
  await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[candidateId,settings.version,JSON.stringify({synthetic:true,inputVersion:1,source:'local acceptance fixture; not live research'})]);
  const spec=(await test.call(`/api/candidates/${candidateId}/specs`,{material:'synthetic silicone',dimensions:'30 cm',packaging:'synthetic single pack',requirements:'local acceptance only',requestedQuantity:300,source:'synthetic fixture'})).body;
  const template=rfqTemplate({product:'QA RFQ '+test.runId,material:spec.material,dimensions:spec.dimensions,packaging:spec.packaging,requirements:spec.requirements,quantity:300});
  async function draft(label){
    const supplier=await test.call(`/api/candidates/${candidateId}/suppliers`,{name:'Synthetic supplier '+label,email:`supplier-${label.toLowerCase()}@fixture.invalid`,source:'synthetic fixture; not a real supplier',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'synthetic matching specification'});assert.equal(supplier.status,201);
    const body={supplierId:supplier.body.id,specId:spec.id,quantity:300,subject:`QA RFQ ${test.runId} ${label}`,body:template.body};const response=await test.call(`/api/candidates/${candidateId}/rfqs`,body);assert.equal(response.status,201);return {rfq:response.body,input:body};
  }
  async function approve(rfq){const p=await test.call(`/api/rfqs/${rfq.id}/approval`,{});assert.equal(p.status,201);const a=await test.call(`/api/approvals/${p.body.approvalId}/approve`,{});assert.equal(a.status,200);const rows=await test.pool.query('SELECT id FROM external_actions WHERE approval_id=$1',[p.body.approvalId]);return {approvalId:p.body.approvalId,actionId:rows.rows[0].id};}
  const a=await draft('A'),b=await draft('B');
  assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM external_actions WHERE rfq_id=ANY($1::uuid[])',[[a.rfq.id,b.rfq.id]])).rows[0].n,0,'Unapproved drafts have no send work');
  const duplicate=await test.call(`/api/candidates/${candidateId}/rfqs`,a.input);assert.equal(duplicate.status,200);assert.equal(duplicate.body.id,a.rfq.id);
  assert.equal((await test.call(`/api/candidates/${candidateId}/rfqs`,{...a.input,body:'different unapproved body'})).status,409);
  const pa=await approve(a.rfq),pb=await approve(b.rfq);
  assert.equal((await test.call(`/api/approvals/${pa.approvalId}/approve`,{})).body.reused,true);
  const local=createMailpitTransport('development');
  const concurrent=await Promise.all([dispatchContact(test.pool,pa.actionId,local),dispatchContact(test.pool,pa.actionId,local)]);assert.deepEqual(concurrent.sort(),['sent','skipped']);assert.equal(await dispatchContact(test.pool,pb.actionId,local),'sent');
  assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[candidateId])).rows[0].stage,'awaiting_quote');
  assert.equal((await test.call(`/api/candidates/${candidateId}`)).body.candidate.nextAction.kind,'waiting','Delivered RFQs wait for a reply instead of claiming automatic progress');
  const receipts=await test.pool.query("SELECT receipt FROM external_actions WHERE id=ANY($1::uuid[]) AND state='sent'",[[pa.actionId,pb.actionId]]);assert.equal(receipts.rowCount,2);assert.ok(receipts.rows.every(r=>JSON.parse(r.receipt).accepted===true));
  const c=await draft('C'),pc=await approve(c.rfq);
  assert.equal(await dispatchContact(test.pool,pc.actionId,null),'skipped');
  assert.equal((await test.pool.query('SELECT blocked_reason FROM candidates WHERE id=$1',[candidateId])).rows[0].blocked_reason,'credential');
  assert.equal((await test.call(`/api/approvals/${pc.approvalId}/reject`,{})).status,200);
  assert.equal((await test.pool.query('SELECT blocked_reason FROM candidates WHERE id=$1',[candidateId])).rows[0].blocked_reason,null);

  const f=await draft('F'),pf=await approve(f.rfq);
  const notSent={name:'acceptance-preflight-change',authorize:async()=>({allowed:true}),send:async()=>({kind:'not_sent',reason:'MAIL_PROFILE_CHANGED'})};
  assert.equal(await dispatchContact(test.pool,pf.actionId,notSent),'blocked');
  assert.deepEqual((await test.pool.query('SELECT state,started_at FROM external_actions WHERE id=$1',[pf.actionId])).rows[0],{state:'blocked',started_at:null});
  assert.equal((await test.call(`/api/approvals/${pf.approvalId}/reject`,{})).status,200,'A confirmed unsent request remains cancellable');
  const recipientFailure=await draft('Recipient'),pr=await approve(recipientFailure.rfq);
  let rejectedAttempts=0;
  const rejectedRecipient={name:'acceptance-recipient-rejection',authorize:async()=>({allowed:true}),send:async()=>{rejectedAttempts++;return {kind:'not_sent',reason:'MAIL_SMTP_RECIPIENT_REJECTED'};}};
  assert.equal(await dispatchContact(test.pool,pr.actionId,rejectedRecipient),'blocked');
  assert.equal(await dispatchContact(test.pool,pr.actionId,rejectedRecipient),'skipped','Permanent recipient rejection requires a new approval instead of automatic retry');
  assert.equal(rejectedAttempts,1);
  assert.equal((await test.call(`/api/approvals/${pr.approvalId}/reject`,{})).status,200);
  const renewedRecipient=await test.call(`/api/rfqs/${recipientFailure.rfq.id}/approval`,{});
  assert.equal(renewedRecipient.status,201);
  const renewedWorkspace=(await test.call(`/api/candidates/${candidateId}/contact`)).body;
  assert.equal(renewedWorkspace.drafts.find(row=>row.id===recipientFailure.rfq.id).deliveryState,null,'A new approval must not inherit the cancelled delivery status of an old approval');
  assert.equal((await test.call(`/api/approvals/${renewedRecipient.body.approvalId}/reject`,{})).status,200);
  let attempts=0;const uncertain={name:'acceptance-uncertain',authorize:async()=>({allowed:true}),send:async()=>{attempts++;return {kind:'unknown',reason:'SIMULATED_TIMEOUT'};}};
  assert.equal(await dispatchContact(test.pool,pc.actionId,uncertain),'skipped');assert.equal(attempts,0);
  const d=await draft('D'),pd=await approve(d.rfq);
  await test.pool.query("UPDATE approvals SET payload=jsonb_set(payload,'{subject}','\"tampered\"'::jsonb) WHERE id=$1",[pd.approvalId]);
  assert.equal(await dispatchContact(test.pool,pd.actionId,uncertain),'skipped');assert.equal(attempts,0);
  const e=await draft('E'),pe=await approve(e.rfq);
  await test.pool.query("UPDATE external_actions SET state='dispatching',started_at=now() WHERE id=$1",[pe.actionId]);await test.pool.query("UPDATE rfq_drafts SET state='sending' WHERE id=$1",[e.rfq.id]);
  const pc2=await approve(c.rfq);assert.equal(await dispatchContact(test.pool,pc2.actionId,uncertain),'unknown');assert.equal(attempts,1);assert.equal(await dispatchContact(test.pool,pc2.actionId,uncertain),'skipped');assert.equal(attempts,1);
  assert.ok(await recoverContactOutcomes(test.pool)>=1);assert.equal(await dispatchContact(test.pool,pe.actionId,uncertain),'skipped');assert.equal(attempts,1);assert.equal(await recoverContactOutcomes(test.pool),0);
  const reply={source:'synthetic response',receivedAt:new Date().toISOString(),messageId:'fixture-'+test.runId,body:'Synthetic reply only <b>plain text</b>'};
  assert.equal((await test.call(`/api/rfqs/${a.rfq.id}/replies`,reply)).status,201);assert.equal((await test.call(`/api/rfqs/${a.rfq.id}/replies`,reply)).body.reused,true);assert.equal((await test.call(`/api/rfqs/${a.rfq.id}/replies`)).body.replies.length,1);
  assert.equal((await test.call(`/api/rfqs/${a.rfq.id}/replies`,{...reply,body:'changed content'})).status,409);

  async function waitForLock(pattern,stopped=()=>false){
    const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!stopped()){
      const result=await test.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE $2) AS waiting",[test.database,pattern]);
      if(result.rows[0].waiting)return true;
    }
    return false;
  }
  const changedInput=await approvedRfq(test,'input-race');
  await test.pool.query("UPDATE candidates SET blocked_reason='credential' WHERE id=$1",[changedInput.candidateId]);
  const holder=await test.pool.connect();let staleSends=0;
  await holder.query('BEGIN');
  await holder.query("UPDATE candidates SET stage='imported',input_version=input_version+1,blocked_reason=NULL WHERE id=$1",[changedInput.candidateId]);
  await holder.query('UPDATE evaluations SET stale=true WHERE candidate_id=$1',[changedInput.candidateId]);
  const staleDispatch=dispatchContact(test.pool,changedInput.action,{name:'acceptance-race',authorize:async()=>({allowed:true}),send:async()=>{staleSends++;return {kind:'not_sent',reason:'SYNTHETIC_NO_SEND'};}});
  try{assert.equal(await waitForLock('%candidates%'),true);}finally{await holder.query('COMMIT');holder.release();await staleDispatch;}
  assert.equal(staleSends,0,'New candidate input committed during admission must prevent dispatch');

  for (const scenario of [
    {name:'latest-hold',outcome:'hold',stale:false,inputVersion:1},
    {name:'latest-fail',outcome:'fail',stale:false,inputVersion:1},
    {name:'latest-stale',outcome:'pass',stale:true,inputVersion:1},
    {name:'old-input',outcome:'pass',stale:false,inputVersion:1,advanceInput:true},
    {name:'unversioned',outcome:'pass',stale:false,advanceInput:true},
  ]) {
    const target=await approvedRfq(test,scenario.name);
    if(scenario.advanceInput)await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[target.candidateId]);
    await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation',$2,$3::jsonb,$4)",[target.candidateId,scenario.outcome,JSON.stringify({synthetic:true,...(scenario.inputVersion?{inputVersion:scenario.inputVersion}:{})}),scenario.stale]);
    const contact=(await test.call(`/api/candidates/${target.candidateId}/contact`)).body;
    assert.equal(contact.contactReady,false,scenario.name+' cannot reuse an obsolete pass');
    assert.equal(contact.blockedReason,'VALIDATION_REQUIRED');
    let authorizations=0,sends=0;
    assert.equal(await dispatchContact(test.pool,target.action,{name:'synthetic-invalid-validation',authorize:async()=>{authorizations++;return {allowed:true};},send:async()=>{sends++;return {kind:'unknown',reason:'UNEXPECTED_SEND'};}}),'skipped');
    assert.equal(authorizations,0);assert.equal(sends,0);
    assert.equal((await test.pool.query('SELECT state FROM external_actions WHERE id=$1',[target.action])).rows[0].state,'cancelled');
    assert.equal((await test.call(`/api/rfqs/${target.draft.id}/approval`,{})).body.code,'CONTACT_NOT_READY','Stale validation cannot request a fresh approval');
    const newVersion=scenario.advanceInput?2:1;
    await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation','pass',$2::jsonb)",[target.candidateId,JSON.stringify({synthetic:true,inputVersion:newVersion})]);
    await test.pool.query("UPDATE candidates SET stage='sourcing',blocked_reason=NULL WHERE id=$1",[target.candidateId]);
    const renewed=await test.call(`/api/rfqs/${target.draft.id}/approval`,{});assert.equal(renewed.status,201);
    assert.equal((await test.call(`/api/approvals/${renewed.body.approvalId}/approve`,{})).status,200);
    const action=(await test.pool.query('SELECT id FROM external_actions WHERE approval_id=$1',[renewed.body.approvalId])).rows[0].id;
    assert.equal(await dispatchContact(test.pool,action,{name:'synthetic-renewed-validation',authorize:async()=>({allowed:true}),send:async()=>{sends++;return {kind:'sent',messageId:'fixture-'+scenario.name,receipt:'synthetic no-network receipt'};}}),'sent');
    assert.equal(sends,1,'Fresh validation and an explicit new approval resume contact');
  }
  const approvalValidation=await approvedRfq(test,'validation-before-approval');
  const originalApproval=(await test.pool.query('SELECT approval_id FROM external_actions WHERE id=$1',[approvalValidation.action])).rows[0].approval_id;
  assert.equal((await test.call(`/api/approvals/${originalApproval}/reject`,{})).status,200);
  const waitingApproval=await test.call(`/api/rfqs/${approvalValidation.draft.id}/approval`,{});assert.equal(waitingApproval.status,201);
  await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation','hold','{\"synthetic\":true,\"inputVersion\":1}'::jsonb)",[approvalValidation.candidateId]);
  assert.equal((await test.call(`/api/approvals/${waitingApproval.body.approvalId}/approve`,{})).body.code,'APPROVAL_STALE');
  assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM external_actions WHERE approval_id=$1',[waitingApproval.body.approvalId])).rows[0].n,0,'Latest hold cannot create a send action on approval');
  const validationRace=await approvedRfq(test,'validation-race');let validationRaceSends=0;
  assert.equal(await dispatchContact(test.pool,validationRace.action,{name:'synthetic-validation-race',authorize:async()=>{
    await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation','hold','{\"synthetic\":true,\"inputVersion\":1}'::jsonb)",[validationRace.candidateId]);return {allowed:true};
  },send:async()=>{validationRaceSends++;return {kind:'unknown',reason:'UNEXPECTED_SEND'};}}),'skipped');
  assert.equal(validationRaceSends,0,'Validation changed during preflight must prevent dispatch');

  const criteriaRace=await approvedRfq(test,'criteria-race');

  const entered=Promise.withResolvers(),release=Promise.withResolvers();let criteriaSends=0;
  const dispatching=dispatchContact(test.pool,criteriaRace.action,{name:'acceptance-criteria-race',authorize:async()=>{entered.resolve();await release.promise;return {allowed:true};},send:async()=>{criteriaSends++;return {kind:'not_sent',reason:'SYNTHETIC_NO_SEND'};}});
  await entered.promise;
  const proposal=await test.call('/api/settings/proposals',{roiPct:'151'});assert.equal(proposal.status,201);
  const criteriaChange=test.call(`/api/approvals/${proposal.body.approvalId}/approve`,{});
  let timeout;
  try{
    const result=await Promise.race([criteriaChange,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Network preflight must not hold the settings lock')),5000);})]);
    assert.equal(result.status,200);
  }finally{clearTimeout(timeout);release.resolve();await dispatching;await criteriaChange;}
  assert.equal(criteriaSends,0,'Changed criteria invalidate admission before message submission');
  console.log(JSON.stringify({scenario:'contact',result:'PASS',database:test.database,runId:test.runId,candidateId,localCaptureCount:2,unapproved:'zero actions',duplicateClick:'single dispatch',revoked:'no dispatch',tampered:'no dispatch',unknown:'no retry',confirmedNotSent:'blocked and cancellable',newInputPreventsSend:true,latestValidationRequired:true,unversionedValidationRejected:true,freshValidationResumes:true,validationChangedDuringPreflightBlocked:true,preflightDoesNotBlockSettings:true,changedCriteriaPreventsSend:true,recovery:'persisted state recovered; real kill covered by verify-contact-recovery.mjs',reply:'original stored once',externalDeliveries:0}));
} finally {await test.close();}
