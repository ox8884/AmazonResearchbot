import {recordInboxQuotes} from "../../apps/worker/src/inbox-quote-loop.ts";
import assert from 'node:assert/strict';
import {approvedRfq} from './approved-rfq.mjs';
import {dispatchContact} from '../../apps/worker/src/contact-runner.ts';
import {resolveApprovedWorkMail} from '../../apps/worker/src/mail-profile-access.ts';
import {storeInboxBatch,inboxMailboxKey} from '../../apps/worker/src/inbox-store.ts';
export async function createInboxFixture(test,key,options={}){
 const config={name:'Synthetic inbox',smtpHost:'smtp.fixture.invalid',smtpPort:465,imapHost:'imap.fixture.invalid',imapPort:993,sender:'buyer@fixture.invalid',username:'buyer@fixture.invalid',sentMailbox:'Sent',inboxMailbox:'INBOX',password:'SYNTHETIC_INBOX_PASSWORD'};
 const saved=await test.call('/api/mail-profile',config);assert.equal(saved.status,201);
 const proposal=await test.call('/api/mail-profile/activation-proposals',{expectedVersion:saved.body.profile.version});assert.equal((await test.call(`/api/approvals/${proposal.body.approvalId}/approve`,{})).status,200);
 const rfq=await approvedRfq(test,'inbox-view');
 const reference=`<forge-rfq-${rfq.action}@fixture.invalid>`;
 await dispatchContact(test.pool,rfq.action,{name:'synthetic-no-network',authorize:async()=>({allowed:true}),send:async()=>({kind:'sent',messageId:reference,receipt:JSON.stringify({accepted:true,messageId:reference})})});
 const approved=await resolveApprovedWorkMail(test.pool,key);assert.ok(approved);
 const make=(uid,overrides={})=>{
  const body='Quantity: 300\nMOQ: 100\nIncoterm: DDP\nUnit price: USD 5.00\nValid until: 2030-01-01\n';
  return {uid,messageId:`<reply-${test.runId}-${uid}@fixture.invalid>`,inReplyTo:[reference],references:[reference],from:['recovery@fixture.invalid'],to:['buyer@fixture.invalid'],subject:'합성 견적 회신',receivedAt:'2026-09-06T12:00:00.000Z',rawSource:Buffer.from('Synthetic original '+uid+'\n'+body),bodyText:body,contentState:'text',attachments:[],...overrides};
 };
 const linked=make(1);
 const unclassified=make(2,{inReplyTo:[],references:[],subject:'연결할 후보를 확인해 주세요',bodyText:'Unclassified <script id="inbox-injection">bad()</script> <b>literal</b>',attachments:[{part:'2',filename:'conditions.csv',mediaType:'text/csv',size:Buffer.byteLength('unit_price,5'),state:'text',bytes:Buffer.from('unit_price,5'),text:'unit_price,5'}]});
 const conflict=make(3,{messageId:linked.messageId,bodyText:'Conflicting original USD 99'});
 const duplicate=make(4,{...linked,uid:4});
 const unsupported=make(5,{subject:'PDF 첨부 · 자동 해석 미지원',bodyText:null,contentState:'unsupported',attachments:[{part:'2',filename:'quote.pdf',mediaType:'application/pdf',size:300,state:'unsupported',bytes:null,text:null}]});
 const missingDate=make(6,{subject:'받은 시각 미확인',receivedAt:null});
 const messages=[linked,unclassified,conflict,duplicate,unsupported,missingDate];
 if(options.includeComplete){const body=['Quantity: 300','MOQ: 100','Incoterm: DDP','Product unit price (USD): 5.00','Unit freight: USD 1','Unit duty: USD 0','Unit prep/inspection: USD 0','Other landed unit cost: USD 0','Separate upfront costs (USD): 200','Valid until: 2030-01-01'].join(String.fromCharCode(10));messages.push(make(7,{subject:'명시 조건이 있는 합성 견적',bodyText:body,rawSource:Buffer.from(body)}));}
 const batch={mailboxKey:inboxMailboxKey(approved.grant),uidValidity:'123',lastUid:messages.length,observedAt:new Date().toISOString(),hasMore:false,messages};
 const stored=await storeInboxBatch(test.pool,key,{grant:approved.grant,batch});assert.equal(stored.kind,'stored');assert.equal(stored.linkedReplies,options.includeComplete?2:1);
 if(options.includeComplete)await recordInboxQuotes(test.pool,key);
 let alternateRfq;
 if(options.includeAlternate){alternateRfq=await approvedRfq(test,"inbox-alternate");const messageId=`<forge-rfq-${alternateRfq.action}@fixture.invalid>`;await dispatchContact(test.pool,alternateRfq.action,{name:"synthetic-no-network",authorize:async()=>({allowed:true}),send:async()=>({kind:"sent",messageId,receipt:JSON.stringify({accepted:true,messageId})})});}
 const rows=(await test.pool.query('SELECT id,uid::int FROM inbox_messages WHERE profile_id=$1',[approved.grant.id])).rows;
 return {rfq,alternateRfq,completeId:rows.find(r=>r.uid===7)?.id,profileId:approved.grant.id,linkedId:rows.find(r=>r.uid===1).id,unclassifiedId:rows.find(r=>r.uid===2).id,conflictId:rows.find(r=>r.uid===3).id,unsupportedId:rows.find(r=>r.uid===5).id,missingDateId:rows.find(r=>r.uid===6).id};
}
