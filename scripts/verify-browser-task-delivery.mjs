import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openBrowserTaskLedger} from '../apps/browser-bridge/task-ledger.mjs';
import {createRecoveryCycle} from '../apps/browser-bridge/recovery-cycle.mjs';
import {createAsideAdapter} from '../apps/browser-bridge/aside-adapter.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createBridgeClient} from '../apps/browser-bridge/enrollment.mjs';
import {deviceVault} from '../apps/browser-bridge/device-vault.mjs';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueSupplierSearch} from '../apps/worker/src/browser-task-producer.ts';
import {signBrowserTask} from '../apps/worker/src/browser-task-signer.ts';
import {createBrowserTaskVerifier} from '../apps/browser-bridge/task-verifier.mjs';
import {decryptSecret} from '../packages/security/src/secrets.ts';
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const address=reservation.address();assert.ok(address&&typeof address==='object');
const origin='http://127.0.0.1:'+address.port;await new Promise(resolve=>reservation.close(resolve));
const test=await openAcceptance({databaseKey:'browser-task-delivery-acceptance',webOrigin:origin});
const keys=browserSigningFixture(),client=createBridgeClient({origin}),vaultEntries=[];
let listen;
const machine=async(url,body,credential)=>{
 const response=await fetch(listen+url,{method:body===undefined?'GET':'POST',headers:{origin,...(credential?{authorization:'Bearer '+credential}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json()};
};
const pair=async name=>{
 const issued=await test.call('/api/bridge/pairings',{});assert.equal(issued.status,201);
 const device=await machine('/api/bridge/pair',{pairingCode:issued.body.pairingCode,name});
 assert.equal(device.status,201);return device.body;
};
const fixture=async(label,validated=true,query)=>{
 const keyword='Synthetic browser delivery '+label+' '+test.runId;
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$2,'sourcing') RETURNING id,input_version",[keyword,query??keyword])).rows[0];
 const version=(await test.call('/api/settings')).body.version;
 if(validated)await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[candidate.id,version,JSON.stringify({synthetic:true,inputVersion:candidate.input_version})]);
 const spec=(await test.call('/api/candidates/'+candidate.id+'/specs',{material:'synthetic',dimensions:'30 cm',packaging:'box',requirements:'synthetic verification',requestedQuantity:300,source:'synthetic fixture'})).body;
 return {id:candidate.id,inputVersion:candidate.input_version,settingsVersion:version,specId:spec.id,keyword:query??keyword};
};
const observation=source=>({
 protocol:1,kind:'captured',scope:'first_results_page',sourcePageUrl:'https://www.alibaba.com/search/page?SearchText='+encodeURIComponent(source.keyword),
 query:source.keyword,observedAt:new Date().toISOString(),snapshot:'Synthetic Alpha Maker, Synthetic Beta Maker, synthetic test only',visibleCards:2,
 records:['Alpha','Beta'].map(name=>({companyName:'Synthetic '+name+' Maker',companyUrl:'https://fixture'+name.toLowerCase()+'.en.alibaba.com/',productName:'Synthetic '+name+' Product',productUrl:'https://www.alibaba.com/product-detail/synthetic-'+name.toLowerCase()+'.html',pageText:'Synthetic '+name+' Maker Synthetic '+name+' Product; not a real supplier record'})),
});
const queue=(source,device)=>queueSupplierSearch(test.pool,{candidateId:source.id,deviceId:device.id},{origin,privateKey:keys.privateKey});
try{
 listen=await test.app.listen({port:address.port,host:'127.0.0.1'});
 assert.equal((await machine('/api/bridge/tasks/claim',{})).status,401);
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const a=await pair('Synthetic device A'),b=await pair('Synthetic device B');
 const unreported=await fixture('unreported');
 assert.equal((await queue(unreported,a)).kind,'not_ready','An enrolled device without a fresh capability report cannot receive work');
 for(const device of [a,b])assert.equal((await machine('/api/bridge/capabilities',{connected:true,supportedTasks:['supplier_search'],keyFingerprint:identity.fingerprint},device.credential)).status,200);
 await deviceVault('create',{origin,deviceId:a.id,credential:a.credential});vaultEntries.push(a);
 await assert.rejects(client.claimTask({deviceId:a.id,origin:'https://other.example.com'}),/INVALID_DEVICE_REQUEST/);
 const held=await fixture('unvalidated',false);assert.equal((await queue(held,a)).kind,'not_ready');
 const newerHold=await fixture('newer-hold');
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','hold',$3::jsonb)",[newerHold.id,newerHold.settingsVersion,JSON.stringify({inputVersion:newerHold.inputVersion,synthetic:true})]);
 assert.equal((await queue(newerHold,a)).kind,'not_ready');
 const source=await fixture('success'),queued=await queue(source,a);
 assert.equal(queued.kind,'queued');assert.equal((await queue(source,a)).kind,'existing');
 assert.equal((await machine('/api/bridge/tasks/claim',{},b.credential)).body.kind,'idle');
 assert.equal((await client.claimTask({deviceId:a.id})).taskId,queued.taskId);
 const claims=await Promise.all([machine('/api/bridge/tasks/claim',{},a.credential),machine('/api/bridge/tasks/claim',{},a.credential)]);
 assert.ok(claims.every(result=>result.status===200&&result.body.taskId===queued.taskId));
 const claim=claims[0].body;
 const verify=createBrowserTaskVerifier({origin,deviceId:a.id,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString()});
 assert.equal(verify(claim.envelope).request.candidateId,source.id);
 const body={taskHash:claim.taskHash,observation:observation(source)};
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId,undefined,b.credential)).status,404);
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId+'/results',body,b.credential)).status,404);
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId+'/results',{...body,taskHash:'0'.repeat(64)},a.credential)).status,409);
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId+'/results',{...body,observation:{...body.observation,sourcePageUrl:'https://www.alibaba.com/search/page?SearchText=wrong'}},a.credential)).status,400);
 const accepted=await Promise.all([machine('/api/bridge/tasks/'+queued.taskId+'/results',body,a.credential),machine('/api/bridge/tasks/'+queued.taskId+'/results',body,a.credential)]);
 assert.deepEqual(accepted.map(value=>value.status).sort(),[200,201]);
 assert.equal(accepted[0].body.receiptId,accepted[1].body.receiptId);
 const receiptId=accepted[0].body.receiptId;
 assert.equal((await client.submitObservation({deviceId:a.id,taskId:queued.taskId,...body})).receiptId,receiptId);
 assert.equal((await client.readTask({deviceId:a.id,taskId:queued.taskId})).state,'completed');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1",[source.id])).rows[0].n,1);
 const saved=(await test.pool.query('SELECT * FROM browser_task_results WHERE id=$1',[receiptId])).rows[0];
 assert.deepEqual(JSON.parse(decryptSecret(saved.body_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),'browser-task-result:'+receiptId).toString()),body.observation);
 const suppliers=(await test.call('/api/candidates/'+source.id+'/contact')).body.suppliers;
 assert.equal(suppliers.length,2);assert.ok(suppliers.every(row=>row.matchStatus==='unknown'&&row.email===null));
 const captures=(await test.call('/api/candidates/'+source.id+'/supplier-captures')).body.captures;
 assert.ok(captures.every(row=>row.captureMethod==='aside_search_result'&&row.sourcePageUrl===body.observation.sourcePageUrl));
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId,undefined,a.credential)).body.receiptId,receiptId);
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId+'/results',{...body,observation:{...body.observation,snapshot:'Changed evidence'}},a.credential)).status,409);
 const stale=await fixture('stale-spec'),staleJob=await queue(stale,a);
 const staleClaim=(await machine('/api/bridge/tasks/claim',{},a.credential)).body;
 await test.call('/api/candidates/'+stale.id+'/specs',{material:'changed',dimensions:'30 cm',packaging:'box',requirements:'synthetic verification',requestedQuantity:300,source:'synthetic newer spec'});
 assert.equal((await machine('/api/bridge/tasks/'+staleJob.taskId+'/results',{taskHash:staleClaim.taskHash,observation:observation(stale)},a.credential)).status,409);
 assert.equal((await machine('/api/bridge/tasks/claim',{},a.credential)).body.kind,'idle');
 const changedInput=await fixture('stale-input'),inputJob=await queue(changedInput,a);
 const inputClaim=(await machine('/api/bridge/tasks/claim',{},a.credential)).body;
 await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[changedInput.id]);
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[changedInput.id,changedInput.settingsVersion,JSON.stringify({synthetic:true,inputVersion:changedInput.inputVersion+1})]);
 assert.equal((await machine('/api/bridge/tasks/'+inputJob.taskId+'/results',{taskHash:inputClaim.taskHash,observation:observation(changedInput)},a.credential)).status,409);
 assert.equal((await machine('/api/bridge/tasks/claim',{},a.credential)).body.kind,'idle');
 const changed=await fixture('stale-settings'),changedJob=await queue(changed,a);
 const changedClaim=(await machine('/api/bridge/tasks/claim',{},a.credential)).body;
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'synthetic-fixture',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1");
 assert.equal((await machine('/api/bridge/tasks/'+changedJob.taskId+'/results',{taskHash:changedClaim.taskHash,observation:observation(changed)},a.credential)).status,409);
 assert.equal((await machine('/api/bridge/tasks/claim',{},a.credential)).body.kind,'idle');
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId+'/results',body,a.credential)).status,200,'Historical receipt retry must remain idempotent after settings change');
 const expired=await fixture('expired'),expiredId=randomUUID(),clock=Date.now();
 const expiredEnvelope=signBrowserTask({version:1,id:expiredId,issuerOrigin:origin,deviceId:b.id,issuedAt:new Date(clock-120000).toISOString(),expiresAt:new Date(clock-60000).toISOString(),request:{kind:'supplier_search',candidateId:expired.id,specId:expired.specId,inputVersion:expired.inputVersion,settingsVersion:expired.settingsVersion,query:expired.keyword}},keys.privateKey);
 const expiredHash=createHash('sha256').update(expiredEnvelope.payload).digest('hex');
 await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,state,expires_at,delivered_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'delivered',$9,now()-interval '90 seconds')",[expiredId,b.id,expired.id,expired.specId,expired.inputVersion,expired.settingsVersion,JSON.stringify(expiredEnvelope),expiredHash,new Date(clock-60000)]);
 assert.equal((await machine('/api/bridge/tasks/'+expiredId+'/results',{taskHash:expiredHash,observation:observation(expired)},b.credential)).status,409);
 assert.equal((await machine('/api/bridge/tasks/claim',{},b.credential)).body.kind,'idle');
 assert.equal((await machine('/api/bridge/tasks/'+expiredId,undefined,b.credential)).body.state,'cancelled');
 assert.equal((await queue(expired,b)).kind,'queued','Expired read attempt can be replaced with a new signed task');
 const late=await fixture('expires-during-claim'),lateId=randomUUID();
 const serverClock=(await test.pool.query('SELECT clock_timestamp() AS time')).rows[0].time.getTime();
 const lateEnvelope=signBrowserTask({version:1,id:lateId,issuerOrigin:origin,deviceId:a.id,issuedAt:new Date(serverClock-1000).toISOString(),expiresAt:new Date(serverClock+2000).toISOString(),request:{kind:'supplier_search',candidateId:late.id,specId:late.specId,inputVersion:late.inputVersion,settingsVersion:late.settingsVersion,query:late.keyword}},keys.privateKey);
 await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",[lateId,a.id,late.id,late.specId,late.inputVersion,late.settingsVersion,JSON.stringify(lateEnvelope),createHash('sha256').update(lateEnvelope.payload).digest('hex'),new Date(serverClock+2000)]);
 const claimConnect=test.pool.connect.bind(test.pool);let delayed=0;
 test.pool.connect=(...args)=>{
  if(typeof args[0]==='function')return claimConnect(...args);
  return claimConnect(...args).then(connection=>{
   const query=connection.query,release=connection.release;
   connection.query=function(...queryArgs){
    if(typeof queryArgs[0]==='string'&&queryArgs[0].includes('FOR UPDATE OF c')){delayed++;return query.call(this,'SELECT pg_sleep(2.2)').then(()=>query.apply(this,queryArgs));}
    return query.apply(this,queryArgs);
   };
   connection.release=function(...releaseArgs){connection.query=query;connection.release=release;return release.apply(connection,releaseArgs);};
   return connection;
  });
 };
 let lateClaim;
 try{lateClaim=await machine('/api/bridge/tasks/claim',{},a.credential);}
 finally{test.pool.connect=claimConnect;}
 assert.equal(delayed,1,'Expiry must happen after selecting the task');
 assert.equal(lateClaim.body.kind,'idle','Never deliver a task that expired while its source was being locked');
 const rollback=await fixture('rollback'),rollbackJob=await queue(rollback,a);
 const rollbackClaim=(await machine('/api/bridge/tasks/claim',{},a.credential)).body;
 const rollbackBody={taskHash:rollbackClaim.taskHash,observation:observation(rollback)};
 const originalConnect=test.pool.connect.bind(test.pool);let injected=0;
 test.pool.connect=(...args)=>{
  if(typeof args[0]==='function')return originalConnect(...args);
  return originalConnect(...args).then(client=>{
   const originalQuery=client.query,originalRelease=client.release;
   client.query=function(...queryArgs){if(typeof queryArgs[0]==='string'&&queryArgs[0]==='COMMIT'){injected++;return Promise.reject(new Error('SYNTHETIC_ATOMIC_FAILURE'));}return originalQuery.apply(this,queryArgs);};
   client.release=function(...releaseArgs){client.query=originalQuery;client.release=originalRelease;return originalRelease.apply(client,releaseArgs);};
   return client;
  });
 };
 try{assert.equal((await machine('/api/bridge/tasks/'+rollbackJob.taskId+'/results',rollbackBody,a.credential)).status,500);}
 finally{test.pool.connect=originalConnect;}
 assert.equal(injected,1);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM sourcing_suppliers WHERE candidate_id=$1',[rollback.id])).rows[0].n,0);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM browser_task_results WHERE task_id=$1',[rollbackJob.taskId])).rows[0].n,0);
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1",[rollback.id])).rows[0].n,0);
 assert.equal((await machine('/api/bridge/tasks/'+rollbackJob.taskId+'/results',rollbackBody,a.credential)).status,201);
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1",[rollback.id])).rows[0].n,1);
 await assert.rejects(test.pool.query("UPDATE browser_tasks SET state='queued',result_id=NULL WHERE id=$1",[queued.taskId]));
 assert.equal((await machine('/api/bridge/tasks/'+rollbackJob.taskId+'/results',rollbackBody,a.credential)).status,200);
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1",[rollback.id])).rows[0].n,1);
 for(const failurePoint of ['before-submit','after-commit']){
  const recovering=await fixture('recovery-'+failurePoint);
  const recoveryJob=await queue(recovering,a);
  const directory=await mkdtemp(path.join(tmpdir(),'forge-cycle-recovery-'));
  const config={directory,origin,deviceId:a.id,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString()};
  let recoveryLedger=openBrowserTaskLedger(config),reads=0;
  const readCredential=()=>deviceVault('read',{origin,deviceId:a.id});
  try{
   const adapter={collect:async envelope=>{const claimed=recoveryLedger.claim(envelope);assert.equal(claimed.kind,'claimed');reads++;return {kind:'captured',taskId:claimed.taskId,taskHash:claimed.taskHash,observation:observation(recovering)};}};
   const unreliable={...client,submitObservation:async input=>{if(failurePoint==='after-commit')await client.submitObservation(input);throw new Error('SIMULATED_CONNECTION_LOSS');}};
   await assert.rejects(createRecoveryCycle({client:unreliable,adapter,ledger:recoveryLedger,deviceId:a.id,readCredential})());
   assert.ok(recoveryLedger.staged(recoveryJob.taskId,await readCredential()));
   recoveryLedger.close();recoveryLedger=openBrowserTaskLedger(config);
   const recovered=await createRecoveryCycle({client,adapter:{collect:async()=>{throw new Error('BROWSER_MUST_NOT_REPEAT');}},ledger:recoveryLedger,deviceId:a.id,readCredential})();
   assert.equal(recovered.kind,'idle');
   assert.equal(reads,1);
   assert.equal(recoveryLedger.inspect(recoveryJob.taskId).state,'completed');
   assert.equal(recoveryLedger.staged(recoveryJob.taskId,await readCredential()),null);
   assert.equal((await test.pool.query("SELECT count(*)::int n FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1",[recovering.id])).rows[0].n,1);
  }finally{
   recoveryLedger.close();
   if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('forge-cycle-recovery-'))throw new Error('UNSAFE_FIXTURE_CLEANUP');
   await rm(directory,{recursive:true,force:true});
  }
 }
 if(process.argv.includes('--client-smoke')){
  const directory=await mkdtemp(path.join(tmpdir(),'forge-client-smoke-'));
  try{
   await test.pool.query('UPDATE bridge_devices SET reported_at=NULL WHERE id=$1',[a.id]);
   const configFile=path.join(directory,'config.json');
   await writeFile(configFile,JSON.stringify({directory:path.join(directory,'state'),origin,deviceId:a.id,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT}));
   const result=await promisify(execFile)(process.execPath,['apps/browser-bridge/run-client.mjs','--config',configFile,'--once'],{cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,timeout:20000});
   assert.equal(JSON.parse(result.stdout.trim()).kind,'idle');
   const report=(await test.pool.query('SELECT reported_connected,reported_tasks,reported_at FROM bridge_devices WHERE id=$1',[a.id])).rows[0];
   assert.ok(report.reported_at,'The real client must report its ASIDE capability before polling');
   assert.equal(report.reported_connected,true);assert.deepEqual(report.reported_tasks,['supplier_search','supplier_detail','amazon_package','saved_search_export','amazon_search']);
  }finally{
   if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('forge-client-smoke-'))throw new Error('UNSAFE_FIXTURE_CLEANUP');
   await rm(directory,{recursive:true,force:true});
  }
 }
 let liveRecordCount=null;
 if(process.argv.includes('--live')){
  const sourceLive=await fixture('live',true,'stainless steel tray');
  const liveJob=await queue(sourceLive,a);assert.equal(liveJob.kind,'queued');
  const received=await client.claimTask({deviceId:a.id});assert.equal(received.taskId,liveJob.taskId);
  const directory=await mkdtemp(path.join(tmpdir(),'forge-broker-live-'));let asideAdapter;
  try{
   asideAdapter=createAsideAdapter({directory,origin,deviceId:a.id,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT});
   const read=await asideAdapter.collect(received.envelope);assert.equal(read.kind,'captured');
   const stored=await client.submitObservation({deviceId:a.id,taskId:read.taskId,taskHash:read.taskHash,observation:read.observation});
   assert.equal(stored.kind,'accepted');
   const serverReceipt=await client.readTask({deviceId:a.id,taskId:read.taskId});
   assert.equal(serverReceipt.state,'completed');assert.equal(serverReceipt.taskHash,read.taskHash);
   asideAdapter.confirmServerReceipt({taskId:read.taskId,taskHash:read.taskHash,receiptId:serverReceipt.receiptId});
   assert.equal(asideAdapter.inspect(read.taskId).state,'completed');
   liveRecordCount=read.observation.records.length;
   const sourceRows=(await test.pool.query('SELECT email,match_status FROM sourcing_suppliers WHERE candidate_id=$1',[sourceLive.id])).rows;
   assert.ok(sourceRows.length>0&&sourceRows.every(row=>row.email===null&&row.match_status==='unknown'));
   await writeFile(new URL('../.omo/evidence/browser-task-delivery/live-chain.json',import.meta.url),JSON.stringify({syntheticEligibility:true,mainDataChanged:false,taskId:read.taskId,receiptId:serverReceipt.receiptId,observedRecords:liveRecordCount,storedSources:sourceRows.length,localState:'completed',serverState:'completed'},null,2));
  }finally{
   asideAdapter?.close();
   if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('forge-broker-live-'))throw new Error('UNSAFE_FIXTURE_CLEANUP');
   await rm(directory,{recursive:true,force:true});
  }
 }
 await test.call('/api/bridge/devices/'+a.id+'/revoke',{});
 assert.equal((await machine('/api/bridge/tasks/claim',{},a.credential)).status,401);
 assert.equal((await machine('/api/bridge/tasks/'+queued.taskId,undefined,a.credential)).status,401);
 console.log(JSON.stringify({scenario:'browser-task-delivery',result:'PASS',actualHttp:true,nativeVaultClient:true,signedWorkerTask:true,deviceIsolation:true,duplicateReceipt:true,staleAndExpiredRejected:true,atomicRollback:true,transactionalNextJob:true,encryptedRecoveryWithoutBrowserRepeat:true,clientEntryPoint:process.argv.includes('--client-smoke'),encryptedSources:true,unknownMatchAndEmailPreserved:true,liveRecordCount,paidAgentStarted:false,supplierContactSent:false,mainDataChanged:false}));
}finally{
 try{for(const entry of vaultEntries)await deviceVault('remove',{origin,deviceId:entry.id,credential:entry.credential});}
 finally{await test.close();}
}
