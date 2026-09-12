import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {orderValidationFixture} from './support/order-market-fixture.mjs';
import {prepareAutomaticRfqs} from '../apps/worker/src/automatic-rfq.ts';

const test=await openAcceptance({databaseKey:'unattended-ui-'+Date.now()});
try{
 const settings=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 const blocked=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage,blocked_reason) VALUES('us',$1,$1,'imported','web_session') RETURNING id",['synthetic hold '+test.runId])).rows[0];
 const ready=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",['synthetic rfq inbox '+test.runId])).rows[0];
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale) VALUES($1,$2,'api_validation','pass',$3::jsonb,false)",[ready.id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot))]);
 const spec=await test.call('/api/candidates/'+ready.id+'/specs',{material:'steel',dimensions:'30 cm',packaging:'box',requirements:'sample inspection',requestedQuantity:300,source:'Unattended UI fixture'});
 assert.equal(spec.status,201);
 for(const n of [1,2]){
  const supplier=await test.call('/api/candidates/'+ready.id+'/suppliers',{name:'Synthetic supplier '+n,email:'supplier'+n+'@fixture.invalid',source:'synthetic UI fixture',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Material, dimensions, packaging and requirements exactly match the captured page evidence.',specId:spec.body.id});
  assert.equal(supplier.status,201);
 }
 assert.equal(await prepareAutomaticRfqs(test.pool,ready.id),2);
 const ko=await test.call('/api/candidates');
 assert.equal(ko.status,200);
 const koReady=ko.body.candidates.find(c=>c.id===ready.id);
 const koHeld=ko.body.candidates.find(c=>c.id===blocked.id);
 assert.equal(koReady.stage,'awaiting_contact_approval');
 assert.equal(koReady.nextAction.kind,'approval');
 assert.equal(koReady.nextAction.target,'supplier_contact');
 assert.equal(koReady.nextAction.label,'견적 요청 보내기');
 assert.equal(koHeld.nextAction.kind,'waiting');
 assert.equal(koHeld.nextAction.target,'web_session');
 const en=await test.call('/api/candidates',undefined,{'accept-language':'en'});
 assert.equal(en.body.candidates.find(c=>c.id===ready.id).nextAction.label,'Send quote requests');
 const detail=await test.call('/api/candidates/'+ready.id);
 assert.equal(detail.status,200);
 assert.ok(detail.body.validation.marketRisk); assert.equal(detail.body.validation.marketRisk.asinCount,8);
 assert.equal(detail.body.candidate.nextAction.kind,'approval');
 const contact=await test.call('/api/candidates/'+ready.id+'/contact');
 assert.equal(contact.status,200);
 assert.equal(contact.body.drafts.length,2);
 assert.ok(contact.body.drafts.every(d=>d.state==='pending_approval'));
 const englishContact=await test.call('/api/candidates/'+ready.id+'/contact',undefined,{'accept-language':'en'});
 assert.equal(englishContact.body.drafts.length,2);
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM external_actions')).rows[0].n,0);
 console.log(JSON.stringify({scenario:'unattended-ui',result:'PASS',todayApproval:'견적 요청 보내기',independentHold:true,pendingRfqs:2,marketRisk:true,externalActions:0,locales:['ko','en']}));
}finally{await test.close();}
