import {ContactRequestError} from "../apps/web/src/contact-api.ts";
import assert from 'node:assert/strict';
import {contactReason,deliveryStateLabel,contactSaveError,contactActionError,supplierMatchLabel} from '../apps/web/src/contact-labels.ts';
for(const code of ['VALIDATION_REQUIRED','MAIL_NOT_CONFIGURED','APPROVAL_STALE','WORKER_RESTARTED_DURING_SEND','UNRECOGNIZED_INTERNAL_CODE']){
  assert.notEqual(contactReason(code,'ko'),code);assert.ok(!contactReason(code,'ko').includes('_'));
  assert.notEqual(contactReason(code,'en'),code);
}
assert.match(contactReason('VALIDATION_REQUIRED','ko'),/공식 확인/);
assert.match(deliveryStateLabel('outcome_unknown','ko'),/재전송 안 함/);
assert.equal(deliveryStateLabel(null,'ko'),'전송 시도 없음');
console.log('PASS: operator-facing contact reasons and delivery states do not expose internal codes.');

assert.match(contactSaveError(new ContactRequestError(409,"AI_RFQ_STALE"),"ko"),/AI 원본/);
assert.match(contactActionError(new ContactRequestError(409,"AI_RFQ_STALE"),"ko"),/다시 불러/);

assert.match(supplierMatchLabel({id:"supplier",candidateId:"candidate",name:"Synthetic",email:null,source:"fixture",observedAt:"2026-09-07T00:00:00Z",createdAt:"2026-09-07T00:00:00Z",matchStatus:"matches",matchNotes:"Old match"},"ko"),/사양 버전 미확인/);
assert.match(contactActionError(new ContactRequestError(409,"RFQ_SOURCE_STALE"),"ko"),/현재 사양/);
