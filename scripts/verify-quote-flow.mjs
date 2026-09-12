import assert from 'node:assert/strict';
import {COST_FIELDS} from '../packages/domain/src/sourcing.ts';
import {openAcceptance} from './support/acceptance.mjs';
import {approvedRfq} from './support/approved-rfq.mjs';
import {dispatchContact} from '../apps/worker/src/contact-runner.ts';
const test=await openAcceptance();
try{
 const subject=await approvedRfq(test,'quote-flow');
 await dispatchContact(test.pool,subject.action,{name:'synthetic-quote-flow',authorize:async()=>({allowed:true}),send:async()=>({kind:'sent',messageId:'fixture',receipt:'{"accepted":true,"messageId":"fixture"}'})});
 const quote=(price='5')=>({specId:subject.draft.specId,supplierName:'Synthetic supplier',supplierSource:'local fixture',sourceText:'Synthetic vendor conditions',receivedAt:'2026-09-06T12:00:00.000Z',validUntil:null,incoterm:'DDP',quantity:300,moq:100,risksConfirmed:false,riskSource:'',costs:Object.fromEntries(COST_FIELDS.map(field=>[field,field==='productUnitPrice'?{kind:'quote',value:price,source:'Synthetic product unit price',observedAt:'2026-09-06T12:00:00.000Z'}:{kind:'unknown',value:null,source:null,observedAt:null}]))});
 const recorded=await test.call(`/api/candidates/${subject.candidateId}/quotes`,quote());assert.equal(recorded.status,201);assert.equal(recorded.body.assessment.outcome,'HOLD');
 const candidate=async()=>(await test.call(`/api/candidates/${subject.candidateId}`)).body.candidate;
 assert.equal((await candidate()).stage,'awaiting_order_decision','A recorded quote must lead to review without claiming GO');
 const supplier=(await test.call(`/api/candidates/${subject.candidateId}/suppliers`,{name:'Second synthetic',email:'second@fixture.invalid',source:'local fixture',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Synthetic match'})).body;
 const draft=(await test.call(`/api/candidates/${subject.candidateId}/rfqs`,{supplierId:supplier.id,specId:subject.draft.specId,quantity:300,subject:'Second synthetic quote request',body:'Synthetic only'})).body;
 async function requestAndReject(){const pending=await test.call(`/api/rfqs/${draft.id}/approval`,{});assert.equal(pending.status,201,'More suppliers remain available after a quote or HOLD');assert.equal((await candidate()).stage,'awaiting_contact_approval');assert.equal((await test.call(`/api/approvals/${pending.body.approvalId}/reject`,{})).status,200);}
 await requestAndReject();assert.equal((await candidate()).stage,'awaiting_order_decision');
 const hold=await test.call(`/api/candidates/${subject.candidateId}/order-packets`,{quoteId:recorded.body.id,decision:'hold',note:'Need more evidence'});assert.equal(hold.status,201);assert.equal((await test.call(`/api/approvals/${hold.body.approvalId}/approve`,{})).status,200);
 assert.equal((await candidate()).stage,'economics_review');await requestAndReject();assert.equal((await candidate()).stage,'economics_review','Cancelling another RFQ must preserve the explicit HOLD');
 assert.equal((await test.call(`/api/candidates/${subject.candidateId}/quotes`,quote('6'))).status,201);assert.equal((await candidate()).stage,'awaiting_order_decision','New quote evidence reopens review');
 await test.pool.query("UPDATE candidates SET stage='decision_recorded' WHERE id=$1",[subject.candidateId]);await test.call(`/api/candidates/${subject.candidateId}/quotes`,quote('7'));assert.equal((await candidate()).stage,'decision_recorded');
 const uncertain=await approvedRfq(test,'quote-flow-unknown');await dispatchContact(test.pool,uncertain.action,{name:'synthetic-unknown',authorize:async()=>({allowed:true}),send:async()=>({kind:'unknown',reason:'SYNTHETIC_UNCONFIRMED'})});
 await test.call(`/api/candidates/${uncertain.candidateId}/quotes`,{...quote(),specId:uncertain.draft.specId});const unknown=(await test.call(`/api/candidates/${uncertain.candidateId}`)).body.candidate;assert.equal(unknown.blockedReason,'external_outcome_unknown');
 console.log(JSON.stringify({scenario:'quote-flow',result:'PASS',quoteLeadsToReviewWithoutGo:true,additionalSuppliersSupported:true,holdPreservedUntilNewQuote:true,terminalPreserved:true,uncertainSendPreserved:true,externalDeliveries:0}));
}finally{await test.close();}
