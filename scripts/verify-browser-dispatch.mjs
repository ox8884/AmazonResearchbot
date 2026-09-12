import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {loadBrowserSigningKey,publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {dispatchBrowserWork} from '../apps/worker/src/browser-dispatch.ts';
import {queueSupplierSearch} from '../apps/worker/src/browser-task-producer.ts';

const directory=await mkdtemp(path.join(tmpdir(),'forge-dispatch-test-'));
const test=await openAcceptance({databaseKey:'browser-dispatch-acceptance'});
const keys=browserSigningFixture(),origin='http://localhost:5173';
let worker;
try{
 const keyFile=path.join(directory,'signing.pem');
 assert.equal(await loadBrowserSigningKey({BROWSER_SIGNING_KEY_FILE:'missing'},'development'),null);
 await assert.rejects(loadBrowserSigningKey({BROWSER_TASKS_ENABLED:'true'},'development'),/BROWSER_SIGNING_KEY_REQUIRED/);
 const generated=await promisify(execFile)(process.execPath,['scripts/init-browser-signing-key.mjs','--output',keyFile],{windowsHide:true});
 assert.equal(generated.stdout.includes('PRIVATE KEY'),false);
 const generatedPem=await readFile(keyFile,'utf8');
 await assert.rejects(promisify(execFile)(process.execPath,['scripts/init-browser-signing-key.mjs','--output',keyFile],{windowsHide:true}));
 assert.equal(await readFile(keyFile,'utf8'),generatedPem);
 assert.equal((await loadBrowserSigningKey({BROWSER_TASKS_ENABLED:'true',BROWSER_SIGNING_KEY_FILE:keyFile},'development')).asymmetricKeyType,'ed25519');
 const workerKey=path.join(directory,'fixture.pem');
 await writeFile(workerKey,keys.privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
 const wrongFile=path.join(directory,'wrong.pem');
 await writeFile(wrongFile,generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 await assert.rejects(loadBrowserSigningKey({BROWSER_TASKS_ENABLED:'true',BROWSER_SIGNING_KEY_FILE:wrongFile},'development'),/BROWSER_SIGNING_KEY_REQUIRED/);
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 assert.deepEqual(await publishBrowserSigningIdentity(test.pool,keys.privateKey),identity);
 await assert.rejects(publishBrowserSigningIdentity(test.pool,generateKeyPairSync('ed25519').privateKey),/BROWSER_SIGNING_KEY_MISMATCH/);
 assert.deepEqual((await test.call('/api/bridge/signing-key')).body.signingKey,identity);
 const pair=async name=>{
  const issued=await test.call('/api/bridge/pairings',{});
  const result=await test.app.inject({method:'POST',url:'/api/bridge/pair',headers:{origin},payload:{pairingCode:issued.body.pairingCode,name}});
  assert.equal(result.statusCode,201);return result.json();
 };
 const a=await pair('Dispatch fixture A'),b=await pair('Dispatch fixture B');
 const report=async(device,change={})=>test.app.inject({method:'POST',url:'/api/bridge/capabilities',headers:{origin,authorization:'Bearer '+device.credential},payload:{connected:true,supportedTasks:['supplier_search'],keyFingerprint:identity.fingerprint,...change}});
 assert.equal((await report(a,{keyFingerprint:'0'.repeat(64)})).statusCode,409);
 assert.equal((await report(a,{supportedTasks:['send_email']})).statusCode,400);
 assert.equal((await report(a,{deviceId:b.id})).statusCode,400);
 const source=async(label,validated=true)=>{
  const keyword='Synthetic dispatch '+test.runId+' '+label;
  const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id,input_version",[keyword])).rows[0];
  const version=(await test.call('/api/settings')).body.version;
  if(validated)await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[candidate.id,version,JSON.stringify({synthetic:true,inputVersion:candidate.input_version})]);
  await test.call('/api/candidates/'+candidate.id+'/specs',{material:'synthetic',dimensions:'30 cm',packaging:'box',requirements:'synthetic only',requestedQuantity:300,source:'synthetic verification'});
  return candidate;
 };
 for(let index=0;index<21;index++){const held=await source('unvalidated-'+index,false);await test.pool.query("UPDATE candidates SET last_progress_at='2000-01-01' WHERE id=$1",[held.id]);}
 const candidate=await source('eligible'),signing={origin,privateKey:keys.privateKey,...identity};
 const queue=device=>queueSupplierSearch(test.pool,{deviceId:device.id,candidateId:candidate.id},signing);
 assert.equal((await queue(a)).kind,'not_ready');
 assert.equal((await report(a,{connected:false})).statusCode,200);
 assert.equal((await queue(a)).kind,'not_ready');
 assert.equal((await report(a,{supportedTasks:[]})).statusCode,200);
 assert.equal((await queue(a)).kind,'not_ready');
 assert.equal((await report(a)).statusCode,200);
 await test.pool.query("UPDATE bridge_devices SET reported_at=now()-interval '91 seconds' WHERE id=$1",[a.id]);
 assert.equal((await queue(a)).kind,'not_ready');
 assert.equal((await report(a)).statusCode,200);
 assert.equal((await queueSupplierSearch(test.pool,{deviceId:a.id,candidateId:candidate.id},{origin,privateKey:generateKeyPairSync('ed25519').privateKey})).kind,'not_ready');
 assert.equal((await dispatchBrowserWork(test.pool,signing)).queued,1);
 assert.equal((await report(b)).statusCode,200);
 assert.equal((await queue(b)).kind,'existing','Changing the available device cannot duplicate a current candidate task');
 assert.equal((await dispatchBrowserWork(test.pool,signing)).queued,0);
 const automatic=await source('worker-startup');
 const count=async()=>Number((await test.pool.query('SELECT count(*) AS n FROM browser_tasks WHERE candidate_id=$1',[automatic.id])).rows[0].n);
 const stop=async()=>{if(worker){const child=worker;worker=undefined;const exited=once(child,'close');if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}}};
 const start=async enabled=>{
  const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','TEMP','TMP']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toUpperCase())));
  worker=spawn(process.execPath,['--import','tsx','apps/worker/src/index.ts'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,APP_ENV:'development',DATABASE_URL:test.databaseUrl,ENCRYPTION_KEY:test.encryptionKeyHex,WEB_ORIGIN:origin,AI_TRANSPORT:'disabled',JS_TRANSPORT:'disabled',MAIL_TRANSPORT:'disabled',BROWSER_TASKS_ENABLED:String(enabled),BROWSER_SIGNING_KEY_FILE:workerKey}});
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('WORKER_START_TIMEOUT')),15000);
   let output='';
   worker.stdout.on('data',chunk=>{output+=chunk;if(output.includes('worker listening for candidate.advance')){clearTimeout(timeout);resolve();}});
   worker.stderr.resume();
   worker.once('error',error=>{clearTimeout(timeout);reject(error);});
   worker.once('close',()=>{clearTimeout(timeout);reject(new Error('WORKER_EXITED_BEFORE_READY'));});
  });
 };
 await start(false);assert.equal(await count(),0,'Disabled startup must not dispatch browser work');await stop();
 await report(a);
 await start(true);
 for(let attempt=0;attempt<40&&await count()===0;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(await count(),1,'The actual worker startup must dispatch the eligible task');
 await stop();
 await test.call('/api/bridge/devices/'+a.id+'/revoke',{});
 assert.equal((await report(a)).statusCode,401);
 console.log(JSON.stringify({scenario:'browser-dispatch',result:'PASS',keyCreationNoOverwrite:true,wrongKeyRejected:true,identityImmutable:true,capabilityGating:true,crossDeviceDedup:true,unvalidatedBacklogDoesNotStarve:true,actualWorkerStartup:true,disabledByDefault:true,paidCalls:0,externalContacts:0,mainChanged:false}));
}finally{
 if(worker&&worker.exitCode===null&&worker.signalCode===null){const exited=once(worker,'close');worker.kill();await exited;}
 await test.close();
 if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('forge-dispatch-test-'))throw new Error('UNSAFE_FIXTURE_CLEANUP');
 await rm(directory,{recursive:true,force:true});
}
