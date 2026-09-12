import {createRecoveryCycle} from '../apps/browser-bridge/recovery-cycle.mjs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,randomUUID,randomBytes,createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {openBrowserTaskLedger} from '../apps/browser-bridge/task-ledger.mjs';
import {signBrowserTask} from '../apps/worker/src/browser-task-signer.ts';
const directory=await mkdtemp(path.join(tmpdir(),'forge-task-ledger-'));
const {publicKey,privateKey}=generateKeyPairSync('ed25519'),now=Date.now();
const config={directory,origin:'https://app.example.com',deviceId:randomUUID(),publicKey:publicKey.export({format:'pem',type:'spki'}).toString()};
const task={version:1,id:randomUUID(),issuerOrigin:config.origin,deviceId:config.deviceId,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+240000).toISOString(),request:{kind:'supplier_search',candidateId:randomUUID(),specId:randomUUID(),inputVersion:1,settingsVersion:1,query:'synthetic task'}};
const envelope=signBrowserTask(task,privateKey);
let ledger;
try {
 ledger=openBrowserTaskLedger(config);
 assert.throws(()=>ledger.claim({...envelope,signature:'a'.repeat(86)}));
 assert.equal(ledger.inspect(task.id),null);
 const claimed=ledger.claim(envelope);assert.equal(claimed.kind,'claimed');
 assert.equal(ledger.claim(envelope).kind,'pending_reconciliation');
 const startChild=(childEnvelope,exitBeforeCompletion=false)=>{
  const child=fork(fileURLToPath(new URL('./support/browser-task-ledger-child.mjs',import.meta.url)),[],{execArgv:[],silent:true,windowsHide:true});
  let result;
  const ready=new Promise((resolve,reject)=>{
   child.once('error',reject);
   child.on('message',message=>{if(message.kind==='ready')resolve();if(message.kind==='result')result=message.result;});
   child.once('exit',()=>reject(new Error('Child exited before ready')));
  });
  const finished=new Promise(resolve=>child.once('exit',code=>resolve({code,result})));
  child.send({kind:'setup',config,envelope:childEnvelope,exitBeforeCompletion});
  return {ready,finished,release:()=>child.send({kind:'claim'})};
 };
 ledger.close();
 const restarted=startChild(envelope);
 await restarted.ready;restarted.release();
 const restartResult=await restarted.finished;
 assert.equal(restartResult.code,0);assert.equal(restartResult.result.kind,'pending_reconciliation');
 ledger=openBrowserTaskLedger(config);
 const raceTask={...task,id:randomUUID()},raceEnvelope=signBrowserTask(raceTask,privateKey);
 const racers=[startChild(raceEnvelope),startChild(raceEnvelope)];
 await Promise.all(racers.map(child=>child.ready));
 racers.forEach(child=>child.release());
 const raceResults=await Promise.all(racers.map(child=>child.finished));
 assert.ok(raceResults.every(result=>result.code===0));
 assert.deepEqual(raceResults.map(result=>result.result.kind).sort(),['claimed','pending_reconciliation']);
 ledger.close();
 const interruptedEnvelope=signBrowserTask({...task,id:randomUUID()},privateKey);
 const interrupted=startChild(interruptedEnvelope,true);
 await interrupted.ready;interrupted.release();assert.equal((await interrupted.finished).code,17);
 ledger=openBrowserTaskLedger(config);
 assert.equal(ledger.claim(interruptedEnvelope).kind,'pending_reconciliation');
 assert.throws(()=>ledger.complete({taskId:randomUUID(),taskHash:claimed.taskHash,receiptId:randomUUID()}));
 const receiptId=randomUUID();
 assert.equal(ledger.complete({taskId:task.id,taskHash:claimed.taskHash,receiptId}).kind,'completed');
 assert.equal(ledger.complete({taskId:task.id,taskHash:claimed.taskHash,receiptId}).kind,'completed');
 assert.equal(ledger.complete({taskId:task.id.toUpperCase(),taskHash:claimed.taskHash,receiptId:receiptId.toUpperCase()}).receiptId,receiptId);
 assert.throws(()=>ledger.complete({taskId:task.id,taskHash:claimed.taskHash,receiptId:randomUUID()}));
 assert.throws(()=>ledger.claim(signBrowserTask({...task,request:{...task.request,query:'changed'}},privateKey)));
 ledger.close();ledger=openBrowserTaskLedger(config);
 assert.deepEqual(ledger.claim(envelope),{kind:'completed',taskId:task.id,taskHash:claimed.taskHash,receiptId});
 assert.equal(ledger.inspect(task.id).state,'completed');
 const stagedTask={...task,id:randomUUID()},stagedEnvelope=signBrowserTask(stagedTask,privateKey);
 const stageClaim=ledger.claim(stagedEnvelope),credential='fbd_'+randomBytes(32).toString('hex');
 const observation={protocol:1,kind:'captured',scope:'first_results_page',sourcePageUrl:'https://www.alibaba.com/search/page?SearchText=synthetic',query:'synthetic',observedAt:new Date().toISOString(),snapshot:'Synthetic only',visibleCards:1,records:[{companyName:'Fixture maker',companyUrl:'https://fixture.en.alibaba.com/',productName:'Fixture product',productUrl:'https://www.alibaba.com/product-detail/fixture.html',pageText:'Fixture maker Fixture product'}]};
 const staged=ledger.stage({...stageClaim,observation},credential);
 assert.ok(ledger.pending().some(row=>row.taskId===stagedTask.id&&row.bodyHash===staged.bodyHash));
 const scope=createHash('sha256').update(config.origin+'|'+config.deviceId).digest('hex');
 const file=path.join(directory,'tasks-'+scope+'.sqlite');
 const disk=Buffer.concat([await readFile(file),await readFile(file+'-wal')]).toString('utf8');
 assert.equal(disk.includes('Fixture maker'),false);assert.equal(disk.includes(credential),false);

 ledger.close();ledger=openBrowserTaskLedger(config);
 assert.deepEqual(ledger.staged(stagedTask.id,credential),observation);
 assert.throws(()=>ledger.staged(stagedTask.id,'fbd_'+randomBytes(32).toString('hex')));
 assert.throws(()=>ledger.stage({...stageClaim,observation:{...observation,snapshot:'Changed'}},credential));
 ledger.settle({taskId:stagedTask.id,taskHash:stageClaim.taskHash,state:'cancelled'});
 assert.equal(ledger.inspect(stagedTask.id).state,'cancelled');
 assert.equal(ledger.pending().some(row=>row.taskId===stagedTask.id),false);
 assert.deepEqual(ledger.staged(stagedTask.id,credential),observation,'Uncertain source must be preserved');
 assert.throws(()=>ledger.complete({...stageClaim,receiptId:randomUUID()}));
 const legacyDirectory=path.join(directory,'legacy');await mkdir(legacyDirectory);
 const old=new DatabaseSync(path.join(legacyDirectory,'tasks-'+scope+'.sqlite'));
 try{
  old.exec("PRAGMA application_id=1179340624; PRAGMA user_version=1; CREATE TABLE task_receipts(task_id TEXT PRIMARY KEY,task_hash TEXT NOT NULL,state TEXT NOT NULL,receipt_id TEXT,created_at TEXT NOT NULL,completed_at TEXT)");
  old.prepare("INSERT INTO task_receipts VALUES(?,?,'completed',?,?,?)").run(task.id,claimed.taskHash,receiptId,'2026-09-08T00:00:00Z','2026-09-08T00:01:00Z');
 }finally{old.close();}
 const upgraded=openBrowserTaskLedger({...config,directory:legacyDirectory});
 try{assert.deepEqual(upgraded.inspect(task.id),{state:'completed',taskId:task.id,taskHash:claimed.taskHash,receiptId});}
 finally{upgraded.close();}
 const policy=openBrowserTaskLedger({...config,directory:path.join(directory,'policy')});
 try{
  const conflictTask={...task,id:randomUUID()},conflictClaim=policy.claim(signBrowserTask(conflictTask,privateKey));
  policy.stage({...conflictClaim,observation},credential);
  const conflictClient={readTask:async()=>({taskHash:conflictClaim.taskHash,state:'completed',receiptId:randomUUID(),resultHash:'f'.repeat(64)}),claimTask:async()=>({kind:'idle'})};
  const noBrowser={collect:async()=>{throw new Error('Unexpected browser repeat');}};
  const conflictResult=await createRecoveryCycle({client:conflictClient,adapter:noBrowser,ledger:policy,deviceId:config.deviceId,readCredential:async()=>credential})();
  assert.equal(conflictResult.reconciled[0].kind,'conflict');
  assert.deepEqual(policy.staged(conflictTask.id,credential),observation);
  const expiredTask={...task,id:randomUUID()},expiredClaim=policy.claim(signBrowserTask(expiredTask,privateKey));
  policy.stage({...expiredClaim,observation},credential);
  let state='delivered';
  const expiryClient={readTask:async()=>({taskHash:expiredClaim.taskHash,state,expiresAt:new Date(Date.now()-1).toISOString()}),claimTask:async()=>{state='cancelled';return {kind:'idle'};},submitObservation:async()=>{throw new Error('Expired result must not be resubmitted');}};
  const expiryCycle=createRecoveryCycle({client:expiryClient,adapter:noBrowser,ledger:policy,deviceId:config.deviceId,readCredential:async()=>credential});
  assert.equal((await expiryCycle()).reconciled[0].kind,'pending_expiry');
  assert.equal((await expiryCycle()).reconciled[0].kind,'cancelled');
  assert.deepEqual(policy.staged(expiredTask.id,credential),observation);
  await assert.rejects(createRecoveryCycle({client:{claimTask:async()=>({kind:'task',taskId:randomUUID(),taskHash:'0'.repeat(64),envelope})},adapter:noBrowser,ledger:policy,deviceId:config.deviceId,readCredential:async()=>credential})(),/SERVER_TASK_HASH_CONFLICT/);
  const missingTask={...task,id:randomUUID()},missingClaim=policy.claim(signBrowserTask(missingTask,privateKey));
  policy.stage({...missingClaim,observation},credential);
  const missingClient={readTask:async()=>{throw Object.assign(new Error('Not found'),{status:404});},claimTask:async()=>({kind:'idle'})};
  const missing=await createRecoveryCycle({client:missingClient,adapter:noBrowser,ledger:policy,deviceId:config.deviceId,readCredential:async()=>credential})();
  assert.equal(missing.reconciled[0].kind,'conflict');
  assert.equal(policy.pending().some(row=>row.taskId===missingTask.id),false);
  assert.deepEqual(policy.staged(missingTask.id,credential),observation);
  const offlineClient={claimTask:async()=>{throw new Error('Offline client must not claim work');}};
  const offlineCycle=createRecoveryCycle({client:offlineClient,adapter:noBrowser,ledger:policy,deviceId:config.deviceId,readCredential:async()=>credential,canClaim:async()=>false});
  assert.equal((await offlineCycle()).kind,'unavailable');
  let probeStopped=false;
  const stoppedProbe=createRecoveryCycle({client:offlineClient,adapter:noBrowser,ledger:policy,deviceId:config.deviceId,readCredential:async()=>credential,shouldStop:()=>probeStopped,canClaim:async()=>{probeStopped=true;return true;}});
  assert.equal((await stoppedProbe()).kind,'stopping');
  let stop=false,releaseClaim,claimStarted;
  const entered=new Promise(resolve=>{claimStarted=resolve;});
  const delayedClaim=new Promise(resolve=>{releaseClaim=resolve;});
  const stoppingCycle=createRecoveryCycle({client:{claimTask:async()=>{claimStarted();return delayedClaim;}},adapter:noBrowser,ledger:policy,deviceId:config.deviceId,readCredential:async()=>credential,shouldStop:()=>stop});
  const inFlight=stoppingCycle();await entered;stop=true;
  releaseClaim({kind:'task',taskId:task.id,taskHash:claimed.taskHash,envelope});
  assert.equal((await inFlight).kind,'stopping','Stop during claim must not start a browser action');
 }finally{policy.close();}



} finally {
 ledger?.close();
 if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('forge-task-ledger-'))throw new Error('UNSAFE_FIXTURE_CLEANUP');
 await rm(directory,{recursive:true,force:true});
}
console.log(JSON.stringify({scenario:'browser-task-ledger',result:'PASS',restartDeduplicated:true,concurrentClaimSingleWinner:true,pendingReconciliationPreserved:true,exitBeforeCompletionPreserved:true,completionIdempotent:true,legacyMigrationPreserved:true,stagingEncrypted:true,conflictsRejected:true,browserExecution:false,externalCalls:0}));
