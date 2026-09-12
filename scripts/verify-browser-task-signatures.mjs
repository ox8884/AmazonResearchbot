import assert from 'node:assert/strict';
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
console.log(JSON.stringify({scenario:'browser-task-signatures',result:'PASS',genuineEd25519:true,wrongKeyDeviceOriginDenied:true,commandsAndExtraFieldsDenied:true,expiryAndSizeChecked:true,browserExecution:false,externalCalls:0}));
