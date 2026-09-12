import assert from 'node:assert/strict';
import { candidateApprovalPath } from '../apps/web/src/candidate-links.ts';
const candidate = { id: 'candidate/with space', nextAction: {kind:'approval',label:'Review',target:'supplier_contact'} } as const;
assert.equal(candidateApprovalPath(candidate), '/candidates/candidate%2Fwith%20space/contact');
assert.equal(candidateApprovalPath({...candidate,nextAction:{...candidate.nextAction,target:'order_decision'}}), '/candidates/candidate%2Fwith%20space/orders');
assert.equal(candidateApprovalPath({...candidate,nextAction:{...candidate.nextAction,kind:'waiting'}}), null);
assert.equal(candidateApprovalPath({...candidate,nextAction:{...candidate.nextAction,kind:'automatic'}}), null);
assert.equal(candidateApprovalPath({...candidate,nextAction:{...candidate.nextAction,target:'unrecognized'}}), null);
console.log('PASS: supported approval targets open the exact candidate review; waiting, automatic and unsupported targets do not expose an approval action.');
