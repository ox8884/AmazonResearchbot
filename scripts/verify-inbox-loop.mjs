import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {approvedRfq} from './support/approved-rfq.mjs';
import {localImapFixture} from './support/imap-fixture.mjs';
import {createImapInboxClient} from '../packages/integrations/src/mail/inbox-client.ts';
import {createInboxCycle} from '../apps/worker/src/inbox-loop.ts';
import {resolveApprovedWorkMail} from '../apps/worker/src/mail-profile-access.ts';
import {readInboxCursor} from '../apps/worker/src/inbox-store.ts';
import {dispatchContact} from '../apps/worker/src/contact-runner.ts';
const encryptionKeyHex='6a'.repeat(32),key=Buffer.from(encryptionKeyHex,'hex');
const test=await openAcceptance({databaseKey:'inbox-loop-'+process.pid+'-'+Date.now().toString(36),encryptionKeyHex});
const fixtures=[];
async function fixture(options={}){const server=await localImapFixture({supplierAddress:'recovery@fixture.invalid',withTerms:true,...options});fixtures.push(server);return server;}
function cycle(server){return createInboxCycle(test.pool,key,{mode:'profile',connector:{resolveHost:async()=>[{address:'8.8.8.8',family:4}],createClient:options=>createImapInboxClient({...options,host:'127.0.0.1',port:server.port,tls:{...options.tls,ca:server.certificate}})}});}
async function childCycle(server){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','scripts/support/poll-inbox-once.mjs'],{cwd:new URL('../',import.meta.url),stdio:['pipe','pipe','pipe']});
  let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Inbox child timed out'));},60000);
  child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.resume();
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);if(code!==0){reject(new Error('Inbox child failed'));return;}try{resolve(JSON.parse(output));}catch(error){reject(error);}});
  child.stdin.end(JSON.stringify({databaseUrl:test.databaseUrl,keyHex:encryptionKeyHex,port:server.port,certificate:server.certificate.toString('base64')}));
 });
}
try{
 const server=await fixture();
 const saved=await test.call('/api/mail-profile',{name:'Synthetic inbox',smtpHost:'smtp.example.com',smtpPort:465,imapHost:'imap.example.com',imapPort:993,sender:'buyer@example.com',username:'buyer@example.com',sentMailbox:'Sent',inboxMailbox:'INBOX',password:server.password});assert.equal(saved.status,201);
 const proposal=await test.call('/api/mail-profile/activation-proposals',{expectedVersion:saved.body.profile.version});assert.equal(proposal.status,201);assert.equal((await test.call(`/api/approvals/${proposal.body.approvalId}/approve`,{})).status,200);
 const rfq=await approvedRfq(test,'inbox-loop');
 const messageId='<forge-rfq-fixture@example.com>';
 assert.equal(await dispatchContact(test.pool,rfq.action,{name:'synthetic-outgoing-no-network',authorize:async()=>({allowed:true}),send:async()=>({kind:'sent',messageId,receipt:JSON.stringify({accepted:true,messageId,transport:'synthetic-outgoing-no-network'})})}),'sent');
 const first=await childCycle(server);assert.equal(first.kind,'stored');assert.equal(first.messagesStored,1);assert.equal(first.linkedReplies,1);assert.equal(first.quoteProcessing.recorded,1);assert.equal((await test.call(`/api/candidates/${rfq.candidateId}/sourcing`)).body.quotes[0].assessment.outcome,'HOLD');
 const replies=await test.call(`/api/rfqs/${rfq.draft.id}/replies`);assert.equal(replies.body.replies.length,1);assert.equal(replies.body.replies[0].body,server.body.toString('utf8'));
 const restarted=await childCycle(server);assert.equal(restarted.kind,'stored');assert.equal(restarted.messagesStored,0,'A new collector process reads the persisted cursor');assert.equal(restarted.quoteProcessing.recorded,0);assert.equal((await test.pool.query('SELECT count(*)::int n FROM supplier_quotes')).rows[0].n,1);
 const resetServer=await fixture({uidValidity:8});const reset=await cycle(resetServer)();assert.equal(reset.kind,'stored');assert.equal(reset.duplicateMessages,1);assert.equal(reset.linkedReplies,0);
 assert.equal((await test.call(`/api/rfqs/${rfq.draft.id}/replies`)).body.replies.length,1);
 const approved=await resolveApprovedWorkMail(test.pool,key);assert.ok(approved);const beforeFailure=await readInboxCursor(test.pool,approved.grant);assert.deepEqual(beforeFailure,{uidValidity:'8',lastUid:1});
 const failedSearch=await fixture({uidValidity:8,uidNext:3,denySearch:true});assert.equal((await cycle(failedSearch)()).kind,'blocked');assert.deepEqual(await readInboxCursor(test.pool,approved.grant),beforeFailure);
 assert.equal((await cycle(failedSearch)()).kind,'blocked');assert.equal((await test.pool.query("SELECT count(*)::int n FROM audit_events WHERE action='mail_inbox_poll_failed' AND target=$1",[approved.grant.id])).rows[0].n,1,'Repeated unchanged failures do not flood the audit');
 const rejected=await fixture({rejectAuthentication:true});assert.equal((await cycle(rejected)()).reason,'MAIL_IMAP_CREDENTIALS_REJECTED');assert.equal((await test.call('/api/mail-profile')).body.profile.status,'disabled');const attempts=rejected.commands.filter(command=>command==='LOGIN').length;assert.equal((await cycle(rejected)()).kind,'disabled');assert.equal(rejected.commands.filter(command=>command==='LOGIN').length,attempts);
 console.log(JSON.stringify({scenario:'inbox-loop',result:'PASS',database:test.database,realLocalTlsRead:true,linkedReplyOriginal:true,automaticQuoteInChildProcess:true,restartedProcessUsesCursor:true,uidValidityResetNoDuplicateReply:true,failedSearchCursorUnchanged:true,unchangedErrorDeduplicated:true,authFailureDisables:true,externalConnections:0,outgoingMessages:0}));
}finally{for(const server of fixtures)await server.close();await test.close();}
