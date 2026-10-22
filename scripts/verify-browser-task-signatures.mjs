import assert from 'node:assert/strict';
import { alibabaObservationSchema, alibabaReplyIsSafe } from '../packages/domain/src/alibaba.ts';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {signBrowserTask} from '../apps/worker/src/browser-task-signer.ts';
import {createBrowserTaskVerifier} from '../apps/browser-bridge/task-verifier.mjs';
const keys=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
const origin='https://app.example.com',deviceId=randomUUID(),now=Date.parse('2026-09-08T12:00:00Z');
const publicKey=keys.publicKey.export({format:'pem',type:'spki'}).toString();
const verifier=createBrowserTaskVerifier({origin,deviceId,publicKey,now:()=>now});
const task={version:1,id:randomUUID(),issuerOrigin:origin,deviceId,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),request:{kind:'supplier_search',candidateId:randomUUID(),specId:randomUUID(),inputVersion:1,settingsVersion:2,query:'steel kitchen tray'}};
const envelope=signBrowserTask(task,keys.privateKey);
assert.deepEqual(verifier(envelope),task);
const withoutSpec={...task,request:{...task.request,specId:null}};
assert.deepEqual(verifier(signBrowserTask(withoutSpec,keys.privateKey)),withoutSpec,'GO supplier discovery must not fabricate a specification');
const conversation={candidateId:task.request.candidateId,specId:null,inputVersion:1,settingsVersion:2,conversationId:randomUUID(),companyName:'Fixture company',companyUrl:'https://fixture.en.alibaba.com/',productUrl:'https://www.alibaba.com/product-detail/Fixture_1600000000000.html',threadId:null,accountId:null};
for(const request of [{kind:'supplier_thread',...conversation},{kind:'supplier_send',...conversation,threadId:'111-222#11011@icbu',accountId:'222',actionId:randomUUID(),body:'Nonbinding quotation request only.'}]){
 const signed={...task,request};
 assert.deepEqual(verifier(signBrowserTask(signed,keys.privateKey)),signed);
 assert.throws(()=>signBrowserTask({...signed,request:{...request,script:'send any message'}},keys.privateKey),'Signed conversation tasks cannot supply executable instructions');
}
assert.throws(()=>signBrowserTask({...task,request:{kind:'supplier_send',...conversation,actionId:randomUUID(),body:'Nonbinding quote only.'}},keys.privateKey),'Send requires a known buyer account and thread');
assert.throws(()=>verifier({...envelope,signature:envelope.signature.slice(0,-2)+'aa'}));
assert.throws(()=>verifier({...envelope,payload:Buffer.from(JSON.stringify({...task,deviceId:randomUUID()})).toString('base64url')}));
for(const patch of [{deviceId:randomUUID()},{issuerOrigin:'https://other.example.com'},{expiresAt:new Date(now).toISOString()},{issuedAt:new Date(now+1000).toISOString()}]){
 assert.throws(()=>verifier(signBrowserTask({...task,...patch},keys.privateKey)));
}
assert.throws(()=>verifier(signBrowserTask(task,other.privateKey)));
const raw=body=>{const payload=Buffer.from(JSON.stringify(body)).toString('base64url');return {version:1,payload,signature:sign(null,Buffer.from('forge-browser-task:v1:'+payload),keys.privateKey).toString('base64url')};};
for(const request of [{kind:'shell',command:'noop'},{kind:'supplier_contact',recipient:'fixture@invalid.test'},{...task.request,script:'noop'},{...task.request,url:'https://other.example.com'}]){
 assert.throws(()=>verifier(raw({...task,request})));
 assert.throws(()=>signBrowserTask({...task,request},keys.privateKey));
}
assert.throws(()=>verifier({...envelope,publicKey:other.publicKey.export({format:'pem',type:'spki'}).toString()}));
assert.throws(()=>verifier({...envelope,version:2}));
assert.throws(()=>verifier({...envelope,payload:envelope.payload+'='}));
assert.throws(()=>verifier({...envelope,payload:'a'.repeat(20000)}));
assert.throws(()=>verifier(raw({...task,expiresAt:new Date(now+600000).toISOString()})));
const exported={...task,request:{kind:'saved_search_export',searchRunId:randomUUID(),searchId:randomUUID(),revision:2,marketplace:'us',category:'Kitchen & Dining',filters:{priceMinUsd:'17.00',monthlySearchMin:0}}};
assert.deepEqual(verifier(signBrowserTask(exported,keys.privateKey)),exported);
const tunneled=createBrowserTaskVerifier({origin:'http://localhost:3302',issuerOrigin:origin,deviceId,publicKey,now:()=>now});
assert.deepEqual(tunneled(envelope),task,'A client reaching the API through a local tunnel trusts the configured issuer origin');
assert.throws(()=>createBrowserTaskVerifier({origin:'http://localhost:3302',deviceId,publicKey,now:()=>now})(envelope),'Without issuerOrigin the transport origin must still match');
assert.throws(()=>createBrowserTaskVerifier({origin,issuerOrigin:'http://evil.example.com',deviceId,publicKey,now:()=>now}),'A non-HTTPS remote issuer is rejected');
const observation={protocol:1,kind:'captured',scope:'alibaba_thread',conversationId:conversation.conversationId,actionId:null,companyName:conversation.companyName,companyUrl:conversation.companyUrl,productUrl:conversation.productUrl,threadId:'111-222#11011@icbu',accountId:'222',sourcePageUrl:'https://message.alibaba.com/message/messenger.htm',observedAt:new Date(now).toISOString(),snapshot:'Fixture only',messages:[{id:'provider-1',direction:'inbound',body:'Please quote 100 units.',sentAt:new Date(now-1000).toISOString()}],sendStatus:'read',reason:null};
assert.ok(alibabaObservationSchema.safeParse(observation).success);
const anchor={providerMessageId:'provider-1',sentAt:new Date(now-1000).toISOString(),bodySha256:'a'.repeat(64)};
const negotiation={keyword:'steel kitchen tray',specification:'No final specification; ask for available options.',lastOutbound:anchor,round:1};
for(const request of [
 {kind:'supplier_thread',...conversation,negotiation},
 {kind:'supplier_send',...conversation,threadId:'111-222#11011@icbu',accountId:'222',actionId:randomUUID(),body:'Nonbinding quote only.',basedOnInbound:anchor},
])assert.deepEqual(verifier(signBrowserTask({...task,request},keys.privateKey)).request,request,'AI context and reply anchor must survive signing and verification');
const proposal={basedOnInbound:anchor,decision:{kind:'reply',body:'Could you quote a lower MOQ for our comparison?'},execution:{sessionId:'fixture-session',provider:'fixture',model:'fixture'}};
assert.ok(alibabaObservationSchema.safeParse({...observation,proposal}).success,'Verified AI proposal is accepted as typed data');
assert.equal(alibabaObservationSchema.safeParse({...observation,proposal:{...proposal,execution:null}}).success,false,'Reply requires actual execution provenance');
assert.equal(alibabaObservationSchema.safeParse({...observation,proposal:{...proposal,basedOnInbound:{...anchor,bodySha256:'invalid'}}}).success,false,'Reply provenance includes a body hash');
assert.equal(alibabaObservationSchema.safeParse({...observation,proposal:{...proposal,script:'send arbitrary message'}}).success,false,'Model proposals cannot carry executable instructions');
assert.ok(alibabaObservationSchema.safeParse({...observation,proposal:{...proposal,decision:{kind:'review',reason:'AI_UNAVAILABLE'},execution:null}}).success);
assert.equal(alibabaObservationSchema.safeParse({...observation,messages:[...observation.messages,...observation.messages]}).success,false,'Repeated provider IDs cannot create two inbound actions');
assert.equal(alibabaObservationSchema.safeParse({...observation,sourcePageUrl:'https://message.alibaba.com.attacker.invalid/message/messenger.htm'}).success,false);
assert.equal(alibabaObservationSchema.safeParse({...observation,accountId:'not-an-account'}).success,false);
assert.equal(alibabaObservationSchema.safeParse({...observation,sendStatus:'sent'}).success,false,'A read receipt cannot claim an unbound send');
assert.equal(alibabaReplyIsSafe('Could you offer MOQ 100 and clarify DDP freight and duties?'),true);
assert.equal(alibabaReplyIsSafe('Could you quote shipping for 500 units?'),true);
assert.equal(alibabaReplyIsSafe('Please quote sample cost and sample lead time only; do not ship a sample.'),true,'Explicit sample shipping prohibition is not a purchase commitment');
for(const safe of ['Please do not send a sample at this stage.','Sample cost and sample lead time only; please do not send a sample at this stage.','DO NOT SHIP ANY SAMPLES AT THIS STAGE.'])assert.equal(alibabaReplyIsSafe(safe),true,'A complete sample prohibition may end with at this stage');
for(const unsafe of ['Please do not send a sample at this stage until payment.','Please do not send a sample at this stage, then send a sample.','Please send a sample at this stage.','If payment clears, do not send a sample at this stage.'])assert.equal(alibabaReplyIsSafe(unsafe),false,'At this stage cannot hide conditional or positive sample commitments');
for(const safe of ['Do not start production or ship anything.','What is the lead time? Please do not start production or ship anything.','Quote only! Do not start production or ship anything. Please quote sample cost only; do not send a sample.'])assert.equal(alibabaReplyIsSafe(safe),true,'A complete unconditional production prohibition is not a commitment');
for(const safe of ['We are not asking you to start production or ship anything.','Quote only. We are not asking you to start production or ship anything.','Do not send a sample, and please do not start production or ship anything.','Please quote sample cost only; do not ship any samples, and do not start production or ship anything.','DO NOT SEND SAMPLES, AND PLEASE DO NOT START PRODUCTION OR SHIP ANYTHING.'])assert.equal(alibabaReplyIsSafe(safe),true,'Complete quotation-only prohibitions must survive the commitment guard');
for(const unsafe of ['We are not asking you to start production or ship anything until payment.','We are not asking you to start production or ship anything unless we pay.','Do not send a sample, and please do not start production or ship anything until payment.','Do not send a sample, and please do not start production or ship anything unless we pay.','Do not send a sample, and please start production.','If payment clears, do not send a sample, and please do not start production or ship anything.','We are not asking you to start production or ship anything. We will take 500 units.'])assert.equal(alibabaReplyIsSafe(unsafe),false,'Extended prohibitions cannot hide conditional or positive commitments');
for(const unsafe of ['Do not start production or ship anything until payment.','Do not start production or ship anything unless we pay.','Do not start production or ship anything, then ship 500 units.','Do not start production or ship anything. Please start production.','Do not start production or ship anything. We will take 500 units.'])assert.equal(alibabaReplyIsSafe(unsafe),false,'Production prohibition cannot hide conditional or positive commitments');
assert.equal(alibabaReplyIsSafe('Do not start'+String.fromCharCode(11)+'production or ship anything.'),false);
for(const control of [11,12])assert.equal(alibabaReplyIsSafe('Please quote sample cost only; do'+String.fromCharCode(control)+'not ship a sample.'),false,'Original control characters must never be normalized away');
for(const unsafe of ['Do not ship a sample. Please ship 500 units.','Do not ship a sample until payment.','Do not ship a sample unless we pay.','Do not ship a sample, then ship 500 units.'])assert.equal(alibabaReplyIsSafe(unsafe),false,'Prohibition must not hide positive or conditional shipping instructions');

for(const unsafe of ['Please ship 500 units.', 'Please send 2 samples.', 'We will take 500 units at USD 4 each.', 'Please invoice us for 500 units.','Agreed, 500 units.', 'Go ahead with production.', "I'll transfer the money.",'We accept your offer.','I will pay the deposit.','Please start production.','Please send us the sample.','Visit https://payment.example.com','Contact me at buyer@example.com'])assert.equal(alibabaReplyIsSafe(unsafe),false,'Binding or off-platform AI output must not become a followup');
for(const unsafe of ['Please place an order on Alibaba.','Kindly make the payment via Trade Assurance.','Please confirm our order of 500 pcs.','Please arrange mass production now.','Please prepare the PI for 500 pcs.','We have transferred the deposit.','请付款'])assert.equal(alibabaReplyIsSafe(unsafe),false,'Common purchase and payment requests must stop for review: '+unsafe);
console.log(JSON.stringify({scenario:'browser-task-signatures',result:'PASS',genuineEd25519:true,wrongKeyDeviceOriginDenied:true,commandsAndExtraFieldsDenied:true,expiryAndSizeChecked:true,browserExecution:false,externalCalls:0}));
