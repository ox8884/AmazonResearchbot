import {resolveApprovedWorkMail} from '../apps/worker/src/mail-profile-access.ts';
import {inboxMailboxKey,storeInboxBatch} from '../apps/worker/src/inbox-store.ts';
import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {createInboxFixture} from './support/inbox-fixture.mjs';
const keyHex='72'.repeat(32),key=Buffer.from(keyHex,'hex');
const test=await openAcceptance({databaseKey:'inbox-api-'+process.pid+'-'+Date.now().toString(36),encryptionKeyHex:keyHex,mailTransport:'profile'});
try{
 await test.pool.query('CREATE SEQUENCE acceptance_inbox_ids AS bigint INCREMENT BY -1 MINVALUE 1 MAXVALUE 100000 START WITH 100000');
 await test.pool.query("ALTER TABLE inbox_messages ALTER COLUMN id SET DEFAULT ('10000000-0000-4000-8000-'||lpad(nextval('acceptance_inbox_ids')::text,12,'0'))::uuid");
 let fixture;
 try{fixture=await createInboxFixture(test,key);}finally{await test.pool.query('ALTER TABLE inbox_messages ALTER COLUMN id SET DEFAULT gen_random_uuid()');}
 const list=await test.call('/api/inbox');assert.equal(list.status,200);assert.equal(list.body.messages.length,5,JSON.stringify(list.body.messages.map(message=>message.classification)));assert.equal(list.body.profileStatus,'active');assert.equal(list.body.collectionEnabled,true);assert.ok(list.body.lastCheckedAt);assert.equal(list.body.messages.some(m=>m.classification==='duplicate'),false);
 assert.equal((await test.call('/api/inbox?filter=unclassified')).body.messages.length,4);
 assert.equal((await test.call('/api/inbox?cursor=invalid')).status,400);
 const detail=await test.call(`/api/inbox/${fixture.unclassifiedId}`);assert.equal(detail.status,200);assert.ok(detail.body.message.body.includes('<script'));assert.equal(detail.body.attachments[0].text,'unit_price,5');assert.equal(detail.body.linkOptions.length,1);assert.equal(detail.body.message.originalAvailable,true);
 assert.ok(!JSON.stringify(detail.body).includes('ciphertext'));assert.ok(!JSON.stringify(detail.body).includes(keyHex));assert.ok(!JSON.stringify(list.body).includes('SYNTHETIC_INBOX_PASSWORD'));
 assert.equal((await test.call(`/api/inbox/${fixture.unclassifiedId}/link`,{rfqId:fixture.rfq.draft.id},{origin:'https://wrong.invalid'})).status,403);
 const links=await Promise.all([test.call(`/api/inbox/${fixture.unclassifiedId}/link`,{rfqId:fixture.rfq.draft.id}),test.call(`/api/inbox/${fixture.unclassifiedId}/link`,{rfqId:fixture.rfq.draft.id})]);assert.ok(links.every(result=>result.status===200));assert.equal(links.filter(result=>result.body.reused).length,1);
 const linked=links[0];assert.equal(linked.body.message.classification,'linked');assert.equal(linked.body.message.candidate.id,fixture.rfq.candidateId);
 assert.equal((await test.call(`/api/inbox/${fixture.unclassifiedId}/link`,{rfqId:fixture.rfq.draft.id})).body.reused,true);
 assert.equal((await test.call('/api/inbox?filter=unclassified')).body.messages.length,3);
 const replies=await test.call(`/api/rfqs/${fixture.rfq.draft.id}/replies`);assert.equal(replies.body.replies.length,2);assert.ok(replies.body.replies.every(reply=>[fixture.linkedId,fixture.unclassifiedId].includes(reply.inboxMessageId)),'Automatic and explicit inbox associations expose verified source links');
 const unlinkedSource=(await test.pool.query('SELECT source_identity,message_id FROM inbox_messages WHERE id=$1',[fixture.unsupportedId])).rows[0];
 for(const input of [
  {source:'mail_inbox:unverified-prefix',messageId:`<prefix-only-${test.runId}@fixture.invalid>`},
  {source:unlinkedSource.source_identity,messageId:unlinkedSource.message_id},
 ]){
  const manual=await test.call(`/api/rfqs/${fixture.rfq.draft.id}/replies`,{...input,receivedAt:'2026-09-06T12:00:00.000Z',body:'Synthetic manually recorded reply'});
  assert.equal(manual.status,201);
  const current=await test.call(`/api/rfqs/${fixture.rfq.draft.id}/replies`);
  assert.equal(current.body.replies.find(reply=>reply.id===manual.body.id)?.inboxMessageId,null,'Prefix or unlinked identity cannot impersonate verified inbox provenance');
 }
 assert.equal((await test.call(`/api/inbox/${fixture.conflictId}/link`,{rfqId:fixture.rfq.draft.id})).status,409);
 assert.equal((await test.call(`/api/inbox/${fixture.unsupportedId}/link`,{rfqId:fixture.rfq.draft.id})).status,400);
 assert.equal((await test.call(`/api/inbox/${fixture.missingDateId}/link`,{rfqId:fixture.rfq.draft.id})).status,400);
 assert.equal((await test.call(`/api/inbox/${fixture.linkedId}`)).body.message.classification,'linked');
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM inbox_message_links')).rows[0].n,1);
 await assert.rejects(test.pool.query('UPDATE inbox_message_links SET rfq_id=rfq_id'));
 const approved=await resolveApprovedWorkMail(test.pool,key);assert.ok(approved);
 for(const [start,count] of [[7,20],[27,6]]){
  const messages=Array.from({length:count},(_,index)=>{const uid=start+index;return {uid,messageId:`<page-${uid}-${test.runId}@fixture.invalid>`,inReplyTo:[],references:[],from:['unknown@fixture.invalid'],to:['buyer@fixture.invalid'],subject:'Pagination fixture',receivedAt:'2026-09-06T12:00:00.000Z',rawSource:Buffer.from('Synthetic page '+uid),bodyText:'Synthetic page '+uid,contentState:'text',attachments:[]};});
  assert.equal((await storeInboxBatch(test.pool,key,{grant:approved.grant,batch:{mailboxKey:inboxMailboxKey(approved.grant),uidValidity:'123',lastUid:start+count-1,observedAt:new Date().toISOString(),hasMore:false,messages}})).kind,'stored');
 }
 const firstPage=(await test.call('/api/inbox')).body;assert.equal(firstPage.messages.length,25);assert.ok(firstPage.nextCursor);
 const secondPage=(await test.call('/api/inbox?cursor='+firstPage.nextCursor)).body;assert.equal(secondPage.messages.length,6);assert.equal(secondPage.nextCursor,null);assert.equal(new Set([...firstPage.messages,...secondPage.messages].map(message=>message.id)).size,31,'Cursor pages must neither repeat nor drop messages');
 console.log(JSON.stringify({scenario:'inbox-api',result:'PASS',database:test.database,rawCiphertextExposed:false,unknownDatesAndBodiesPreserved:true,manualLinkIdempotent:true,conflictsPreserved:true,originGuard:true,paginationNoLossOrDuplicates:true,externalConnections:0}));
}finally{await test.close();}
