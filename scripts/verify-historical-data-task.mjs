import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueHistoricalData} from '../apps/worker/src/browser-task-producer.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';

const reserve=createServer();
reserve.listen(0,'127.0.0.1');
await once(reserve,'listening');
const address=reserve.address();
assert.ok(address&&typeof address==='object');
await new Promise(resolve=>reserve.close(resolve));

const origin='http://127.0.0.1:'+address.port;
const test=await openAcceptance({databaseKey:'historical-data-task-'+Date.now(),webOrigin:origin});
try{
 await test.app.listen({host:'127.0.0.1',port:address.port});
 const keys=browserSigningFixture();
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pairing=await test.call('/api/bridge/pairings',{});
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic Historical Data observer'});
 assert.equal(enrolled.status,201);
 const deviceId=enrolled.body.id;
 const call=async(url,body)=>{
  const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{origin,authorization:'Bearer '+enrolled.body.credential,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10_000)});
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await call('/api/bridge/capabilities',{connected:true,supportedTasks:['historical_data'],keyFingerprint:identity.fingerprint})).status,200);
 const query='synthetic historical data '+test.runId;
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[query])).rows[0];
 const queued=await queueHistoricalData(test.pool,{deviceId,candidateId:candidate.id},{origin,privateKey:keys.privateKey});
 assert.equal(queued.kind,'queued');
 const claim=(await call('/api/bridge/tasks/claim',{})).body;
 assert.equal(claim.taskId,queued.taskId);
 const request=JSON.parse(Buffer.from(claim.envelope.payload,'base64url')).request;
 assert.equal(request.kind,'historical_data');
 assert.equal(request.query,query);
 const observation={protocol:1,kind:'captured',scope:'jungle_scout_historical_data',query,sourcePageUrl:'https://members.junglescout.com/historical-data',observedAt:new Date().toISOString(),snapshot:'Synthetic Historical Data result',dateRange:{label:'Jan 1, 2026 – Jan 31, 2026',start:'2026-01-01T00:00:00.000Z',end:'2026-01-31T00:00:00.000Z'},series:[{metric:'Search Volume',periodLabel:'Jan 1, 2026',value:'2,400',sourceText:'Search Volume Jan 1, 2026 2,400'}]};
 const submit=value=>call('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation:value});
 const accepted=await submit(observation);
 assert.equal(accepted.status,201);
 const duplicate=await submit(observation);
 assert.equal(duplicate.status,200);
 const stored=(await test.pool.query('SELECT body_ciphertext,capture_ids FROM browser_task_results WHERE id=$1',[accepted.body.receiptId])).rows[0];
 assert.deepEqual(stored.capture_ids,[],'Historical Data observations retain only browser provenance');
 assert.deepEqual(JSON.parse(decryptSecret(stored.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+accepted.body.receiptId)),observation);
 const stale=await submit({...observation,observedAt:'2020-01-01T00:00:00.000Z'});
 assert.equal(stale.status,409);
 console.log(JSON.stringify({scenario:'signed_historical_data_aside_task',result:'PASS',signedTask:true,claimed:true,encryptedReceipt:true,duplicateReceipt:true,staleRejected:true,paidApiCalls:0,externalActions:0}));
}finally{await test.close();}
