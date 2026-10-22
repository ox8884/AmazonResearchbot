import {ContactRequestError} from "../apps/web/src/contact-api.ts";
import assert from 'node:assert/strict';
import {alibabaActionLabel,alibabaStatusLabel,contactReason,deliveryStateLabel,contactSaveError,contactActionError,supplierMatchLabel} from '../apps/web/src/contact-labels.ts';
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

assert.match(alibabaActionLabel('outcome_unknown','ko'),/결과 미확인.*재전송 안 함/);
assert.match(alibabaActionLabel('outcome_unknown','en'),/unknown.*no resend/);
assert.equal(alibabaActionLabel('sent','ko'),'발송 확인됨');
assert.equal(alibabaStatusLabel('paused','ko'),'자동 연락 중지');
assert.equal(alibabaStatusLabel('attention','ko'),'확인 필요');
assert.equal(alibabaStatusLabel('negotiating','ko','SEND_OUTCOME_UNKNOWN'),'발송 결과 미확인');
assert.match(contactReason('SEND_OUTCOME_UNKNOWN','ko'),/다시 보내지 않습니다/);
assert.match(contactReason('BINDING_REQUEST_REQUIRES_REVIEW','ko'),/확약.*멈췄/);
assert.match(contactReason('THREAD_OWNERSHIP_CONFLICT','ko'),/다른 후보/);
console.log('PASS: Alibaba unknown sends remain distinct from confirmed sends and paused contact.');
