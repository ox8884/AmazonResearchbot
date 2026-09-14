import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueProductDatabase} from '../apps/worker/src/browser-task-producer.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';

const reserve=createServer();
reserve.listen(0,'127.0.0.1');
await once(reserve,'listening');
const address=reserve.address();
assert.ok(address&&typeof address==='object');
await new Promise(resolve=>reserve.close(resolve));

const origin='http://127.0.0.1:'+address.port;
const test=await openAcceptance({databaseKey:'product-database-task-'+Date.now(),webOrigin:origin});
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const keys=browserSigningFixture();
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pairing=await test.call('/api/bridge/pairings',{});
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic Product Database observer'});
 assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id;
 const call=async(url,body)=>{
  const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{origin,authorization:'Bearer '+enrolled.body.credential,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10_000)});
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['product_database'],keyFingerprint:identity.fingerprint})).status,200);
 const query='synthetic product database '+test.runId;
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[query])).rows[0];
 const queued=await queueProductDatabase(test.pool,{deviceId,candidateId:candidate.id},{origin,privateKey:keys.privateKey});
 assert.equal(queued.kind,'queued');
 const claim=(await call('/api/bridge/tasks/claim',{})).body;
 assert.equal(claim.taskId,queued.taskId);
 const request=JSON.parse(Buffer.from(claim.envelope.payload,'base64url')).request;
 assert.deepEqual(request.kind,'product_database');
 assert.equal(request.query,query);
 const observation={protocol:1,kind:'captured',scope:'jungle_scout_product_database',query,sourcePageUrl:'https://members.junglescout.com/#/database',observedAt:new Date().toISOString(),snapshot:'Synthetic Product Database result',records:[{asin:'B0PD000001',title:'Synthetic kitchen organizer',sourceText:'B0PD000001 Synthetic kitchen organizer'}]};
 const submit=value=>call('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation:value});
 const accepted=await submit(observation);
 assert.equal(accepted.status,201);
 const duplicate=await submit(observation);
 assert.equal(duplicate.status,200);
 const stored=(await test.pool.query('SELECT body_ciphertext,capture_ids FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(stored.capture_ids,[],'Product Database display observations do not fabricate API evidence');
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId)),observation);
 const stale=await submit({...observation,observedAt:'2020-01-01T00:00:00.000Z'});
 assert.equal(stale.status,409);
 console.log(JSON.stringify({scenario:'signed_product_database_aside_task',result:'PASS',signedTask:true,claimed:true,encryptedReceipt:true,duplicateReceipt:true,staleRejected:true,paidApiCalls:0,externalActions:0}));
}finally{await test.close();}
