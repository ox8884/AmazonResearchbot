import assert from 'node:assert/strict';
import {localImapFixture} from './support/imap-fixture.mjs';
import {createImapInboxTransport} from '../packages/integrations/src/mail/inbox.ts';
import {createImapInboxClient} from '../packages/integrations/src/mail/inbox-client.ts';
const grant={id:'wire-profile',version:1,secretVersion:1,config:{name:'Synthetic mailbox',smtpHost:'smtp.example.com',smtpPort:465,imapHost:'imap.example.com',imapPort:993,sender:'buyer@example.com',username:'buyer@example.com',sentMailbox:'Sent',inboxMailbox:'INBOX'}};
for(const scenario of ['read','attachments','auth-rejected','search-failed']){
 const fixture=await localImapFixture({rejectAuthentication:scenario==='auth-rejected',denySearch:scenario==='search-failed',withAttachments:scenario==='attachments'});
 let active=true;
 try{
  const transport=createImapInboxTransport(grant,{isCurrent:async()=>active,readPassword:async()=>fixture.password,pauseProfile:async()=>{active=false;return true;}},{resolveHost:async()=>[{address:'8.8.8.8',family:4}],createClient:options=>{
   assert.equal(options.host,'8.8.8.8');assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.tls.servername,'imap.example.com');
   return createImapInboxClient({...options,host:'127.0.0.1',port:fixture.port,tls:{...options.tls,ca:fixture.certificate}});
  }});
  const result=await transport.read(null);
  if(scenario==='read'||scenario==='attachments'){
   assert.equal(result.kind,'batch');assert.equal(result.batch.messages.length,1);
   const message=result.batch.messages[0];assert.equal(message.bodyText,fixture.body.toString('utf8'));assert.equal(message.subject,'합성 견적');assert.deepEqual(Buffer.from(message.rawSource),fixture.raw);assert.equal(result.batch.lastUid,1);
   if(scenario==='attachments'){assert.equal(message.attachments.length,2);assert.deepEqual(Buffer.from(message.attachments[0].bytes),fixture.csvBytes);assert.equal(message.attachments[0].size,fixture.csvBytes.length);assert.equal(message.attachments[1].state,'unsupported');assert.equal(message.attachments[1].bytes,null);assert.equal(fixture.observations().unsupportedPartFetches,0);}
   assert.equal(fixture.observations().allFetchesPeek,true);assert.ok(fixture.commands.includes('EXAMINE'));assert.ok(fixture.commands.includes('UID FETCH'));
  }else if(scenario==='auth-rejected'){assert.equal(result.kind,'blocked');assert.equal(result.reason,'MAIL_IMAP_CREDENTIALS_REJECTED');assert.equal(active,false);}
  else{assert.equal(result.kind,'blocked','A server NO to SEARCH must not commit an empty cursor');assert.equal(active,true);}
  assert.equal(fixture.observations().credentialsMatched,true);
  assert.ok(!fixture.commands.some(command=>['SELECT','STORE','UID STORE','APPEND','EXPUNGE','UID EXPUNGE'].includes(command)));
  assert.ok(!JSON.stringify(result).includes(fixture.password));
 }finally{await fixture.close();}
}
console.log(JSON.stringify({scenario:'inbox-wire',result:'PASS',transport:'actual local TLS + installed ImapFlow',authentication:true,readOnlyPeek:true,utf8AndRawPreserved:true,textAttachmentDecoded:true,unsupportedAttachmentFetches:0,authRejectionPauses:true,failedSearchNotEmpty:true,externalConnections:0}));
