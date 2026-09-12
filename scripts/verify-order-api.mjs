import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openAcceptance} from './support/acceptance.mjs';
import {createOrderFixture} from './support/order-fixture.mjs';
import {riskReview} from './support/order-fixture.mjs';
import {orderMarketFixture,orderValidationFixture} from './support/order-market-fixture.mjs';
import {exactPayloadHash} from '../packages/security/src/approval-hash.ts';
const test=await openAcceptance();
const created=[];
try {
 const candidate=label=>createOrderFixture(test,label);
 const unchecked=await candidate('missing-item-risk-review');
 const uncheckedResult=await test.call(`/api/candidates/${unchecked.id}/order-packets`,{quoteId:unchecked.quoteId,decision:'go',note:'Synthetic missing item review'});
 assert.equal(uncheckedResult.status,409,'The quote risk checkbox alone must not authorize a new GO without item-specific review');
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM order_packets WHERE candidate_id=$1',[unchecked.id])).rows[0].n,0);
 for(const [label,review] of [
  ['unknown-check',riskReview('00000000-0000-4000-8000-000000000000','clear',{brand:{status:'unknown'}})],
  ['risk-check',riskReview('00000000-0000-4000-8000-000000000000','risk')],
 ]){
  const subject=await candidate(label);
  const denied=await test.call(`/api/candidates/${subject.id}/order-packets`,{quoteId:subject.quoteId,decision:'go',note:'Synthetic adverse risk review',riskReview:{...review,scope:{...review.scope,specId:subject.specId}}});
  assert.equal(denied.status,409,label+' must not authorize GO');
  assert.equal(denied.body.code,'ORDER_NOT_READY');
  assert.equal((await test.pool.query('SELECT count(*)::int n FROM order_packets WHERE candidate_id=$1',[subject.id])).rows[0].n,0);
 }
 const preserved=await candidate('risk-preserved');
 const preservedPacket=await request(preserved);
 const preservedPayload=(await test.pool.query('SELECT payload FROM order_packets WHERE id=$1',[preservedPacket.id])).rows[0].payload;
 assert.equal(preservedPayload.riskReview.kind,'operator_record','Reviewed risk evidence must be preserved in the stored payload');
 assert.equal(preservedPayload.riskReview.scope.specId,preserved.specId);
 assert.deepEqual(Object.keys(preservedPayload.riskReview.checks).sort(),['brand','returns','selling']);
 const legacy=await candidate('approval-legacy-review'),legacyPacket=await request(legacy);
 const legacyApprovalId=randomUUID(),legacyPacketId=randomUUID();
 const stored=(await test.pool.query('SELECT payload FROM order_packets WHERE id=$1',[legacyPacket.id])).rows[0].payload;
 const {riskReview:_omitted,...legacyPayload}=stored;
 const legacyHash=exactPayloadHash(legacyPayload);
 await test.pool.query("INSERT INTO approvals(id,kind,candidate_id,payload_hash,payload,status) VALUES($1,'order_decision',$2,$3,$4::jsonb,'pending')",[legacyApprovalId,legacy.id,legacyHash,JSON.stringify(legacyPayload)]);
 await test.pool.query("INSERT INTO order_packets(id,candidate_id,quote_id,spec_id,settings_version,decision,note,payload,payload_hash,approval_id,created_by) VALUES($1,$2,$3,$4,$5,'go',$6,$7::jsonb,$8,$9,(SELECT created_by FROM order_packets WHERE id=$10))",[legacyPacketId,legacy.id,stored.source.quote.id,stored.source.spec.id,stored.settings.version,stored.note,JSON.stringify(legacyPayload),legacyHash,legacyApprovalId,legacyPacket.id]);
 assert.equal((await test.call(`/api/approvals/${legacyApprovalId}/approve`,{})).status,409,'Approval must fail when the recorded risk review is absent');
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM launch_cash_reservations WHERE candidate_id=$1',[legacy.id])).rows[0].n,0);
 async function request(subject,decision='go',review){
  const result=await test.call(`/api/candidates/${subject.id}/order-packets`,{quoteId:subject.quoteId,decision,note:'Synthetic review, no actual order',...(decision==='go'?{riskReview:review??riskReview(subject.specId)}:{})});
  assert.equal(result.status,201,JSON.stringify(result.body));created.push(result.body.packet);return result.body.packet;
 }
 async function invalidate(subject,scenario){
  if(scenario==='old-input')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[subject.id]);
  else if(scenario==='unversioned')await test.pool.query("UPDATE evaluations SET payload=payload-'inputVersion' WHERE candidate_id=$1 AND payload->>'synthetic'='true'",[subject.id]);
  else await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale,created_at) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation',$2,'{\"synthetic\":true,\"inputVersion\":1}'::jsonb,$3,clock_timestamp())",[subject.id,scenario==='stale'?'pass':scenario,scenario==='stale']);
 }
 for(const scenario of ['hold','reject','stale','old-input','unversioned']){
  const prepare=await candidate('prepare-'+scenario);
  await invalidate(prepare,scenario);
  const rejected=await test.call(`/api/candidates/${prepare.id}/order-packets`,{quoteId:prepare.quoteId,decision:'go',note:'Synthetic latest-assessment regression'});
  assert.equal(rejected.status,409,'GO preparation must reject '+scenario+' despite an earlier pass');
  assert.equal(rejected.body.code,'ORDER_NOT_READY');
  assert.equal((await test.pool.query('SELECT count(*)::int n FROM order_packets WHERE candidate_id=$1',[prepare.id])).rows[0].n,0);
  const approve=await candidate('approve-'+scenario),packet=await request(approve);
  await invalidate(approve,scenario);
  const denied=await test.call(`/api/approvals/${packet.approvalId}/approve`,{});
  assert.equal(denied.status,409,'GO approval must reject '+scenario+' despite an earlier pass');
  assert.equal(denied.body.code,'APPROVAL_STALE');
  assert.equal((await test.pool.query('SELECT count(*)::int n FROM launch_cash_reservations WHERE candidate_id=$1',[approve.id])).rows[0].n,0);
  if(scenario==='hold'){
   const snapshot=(await test.pool.query('SELECT snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0].snapshot;
   await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale,created_at) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation','pass',$2::jsonb,false,clock_timestamp())",[prepare.id,JSON.stringify({synthetic:true,inputVersion:1,firstPageSales:orderMarketFixture(snapshot)})]);
   await request(prepare);
  }
 }
 async function marketEvaluation(subject,mode){
  const snapshot=(await test.pool.query('SELECT snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0].snapshot;
  const page=orderMarketFixture(snapshot,mode==='unknown-status-pass'?'unknown':mode==='caution-status-pass'?'caution':mode);
  if(mode==='criteria-mismatch')page.criteria.shareTop1MustBeBelowPct='99';
  if(mode==='unknown-status-pass'||mode==='caution-status-pass')page.concentration.assessment={top1:'pass',top3:'pass',firstPageSales:'pass'};
  if(mode==='reversed-shares'){page.concentration.top1Pct.value='30';page.concentration.top3Pct.value='20';}
  if(mode==='zero-families')page.concentration.families.value=0;
  if(mode==='excess-families')page.concentration.families.value=page.marketAsins.length+1;
  if(mode==='wrong-total')page.concentration.firstPageSalesUsd.value='350000.00';
  if(mode==='missing-observations')delete page.observations;
  if(mode==='zero-total'){page.concentration.firstPageSalesUsd.value='0.00';for(const row of page.observations)row.approximate30DayRevenue.value=0;}
  const payload=orderValidationFixture(snapshot);if(mode==='missing')delete payload.firstPageSales;else payload.firstPageSales=page;
  await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale,created_at) VALUES($1,(SELECT max(version) FROM settings_versions),'api_validation','pass',$2::jsonb,false,clock_timestamp())",[subject.id,JSON.stringify(payload)]);
 }
 for(const mode of ['missing','unknown','caution','criteria-mismatch','unknown-status-pass','caution-status-pass','reversed-shares','zero-families','excess-families','wrong-total','missing-observations','zero-total']){
  if(mode==='zero-total')await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'synthetic-zero-denominator-regression',snapshot || '{\"firstPageSalesMinUsd\":\"0\"}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1");
  const prepare=await candidate('market-prepare-'+mode);await marketEvaluation(prepare,mode);
  const denied=await test.call(`/api/candidates/${prepare.id}/order-packets`,{quoteId:prepare.quoteId,decision:'go',note:'Synthetic market readiness check'});
  assert.equal(denied.status,409,'GO preparation must reject market '+mode+' even when quote risks are checked');
  if(!['missing','unknown','caution'].includes(mode))assert.equal((await test.call(`/api/candidates/${prepare.id}`)).body.validation.marketRisk,null,'Inconsistent market evidence must not enable the UI');
  const approve=await candidate('market-approve-'+mode),packet=await request(approve);await marketEvaluation(approve,mode);
  assert.equal((await test.call(`/api/approvals/${packet.approvalId}/approve`,{})).status,409,'Approval must recheck market '+mode);
  assert.equal((await test.pool.query('SELECT count(*)::int n FROM launch_cash_reservations WHERE candidate_id=$1',[approve.id])).rows[0].n,0);
  const holdPacket=await request(prepare,'hold');assert.equal((await test.call(`/api/approvals/${holdPacket.approvalId}/approve`,{})).status,200,'Hold remains available with incomplete or adverse market evidence');
 }
 const a=await candidate('a'),b=await candidate('b');
 const first=await request(a),second=await request(b);
 const before=await test.call(`/api/candidates/${a.id}/orders`);
 assert.equal(before.body.reservations.length,0);
 const responses=await Promise.all([first,second].map(p=>test.call(`/api/approvals/${p.approvalId}/approve`,{})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const winner=responses[0].status===200?first:second;
 const loser=winner===first?second:first;
 assert.equal(responses.find(r=>r.status===409).body.code,'INSUFFICIENT_LAUNCH_CASH');
 const again=await test.call(`/api/approvals/${winner.approvalId}/approve`,{});
 assert.equal(again.status,200);assert.equal(again.body.reused,true);
 const pending=await test.call('/api/approvals?kind=order_decision&status=pending');
 assert.ok(pending.body.approvals.some(p=>p.id===loser.approvalId&&p.payload.packetId===loser.id));
 const after=await test.call(`/api/candidates/${a.id}/orders`);
 assert.deepEqual(Object.fromEntries(Object.entries(after.body.budget).map(([key,value])=>[key,Number(value)])),{limitUsd:3000,reservedUsd:2600,availableUsd:400});
 const originalSettings=(await test.call('/api/settings')).body;
 const lower=await test.call('/api/settings/proposals',{launchBudgetUsd:'2500'});assert.equal(lower.status,201);
 const lowerResult=await test.call(`/api/approvals/${lower.body.approvalId}/approve`,{});
 assert.equal(lowerResult.status,409);assert.equal(lowerResult.body.code,'LAUNCH_BUDGET_RESERVED');
 assert.equal((await test.call('/api/settings')).body.version,originalSettings.version);
 assert.ok((await test.call('/api/approvals?kind=budget_or_criteria_change&status=pending')).body.approvals.some(p=>p.id===lower.body.approvalId));
 await test.call(`/api/approvals/${lower.body.approvalId}/reject`,{});
 const reject=await test.call(`/api/approvals/${loser.approvalId}/reject`,{});assert.equal(reject.status,200);
 assert.equal((await test.call(`/api/order-packets/${loser.id}`)).body.packet.state,'cancelled');
 const tamper=await test.call(`/api/approvals/${winner.approvalId}/approve`,{decision:'reject'});assert.equal(tamper.status,400);
 const released=await test.call(`/api/order-packets/${winner.id}/cancel`,{note:'Synthetic reservation release'});assert.equal(released.status,200);
 const replay=await test.call(`/api/order-packets/${winner.id}/cancel`,{note:'Repeated release'});assert.equal(replay.body.reused,true);
 assert.equal(Number((await test.call(`/api/candidates/${a.id}/orders`)).body.budget.availableUsd),3000);
 const hold=await request(a,'hold');assert.equal((await test.call(`/api/approvals/${hold.approvalId}/approve`,{})).status,200);
 assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[a.id])).rows[0].stage,'economics_review');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM launch_cash_reservations WHERE state='active'")).rows[0].n,0);
 console.log(JSON.stringify({scenario:'order-api',result:'PASS',runId:test.runId,database:test.database,concurrency:'one reserved, one pending',replay:'idempotent',rejection:'cancelled without reservation',release:'explicit and idempotent',hold:'no reservation',latestEvaluationRequired:true,inputVersionRequired:true,revalidationResumes:true,externalActions:0}));
}finally{try{for(const packet of created)await test.call(`/api/order-packets/${packet.id}/cancel`,{note:'Synthetic acceptance cleanup release'});}finally{await test.close();}}
