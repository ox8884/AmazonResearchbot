import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAsideAdapter} from '../apps/browser-bridge/aside-adapter.mjs';
import {signBrowserTask} from '../apps/worker/src/browser-task-signer.ts';
import {supplierDetailCapture} from '../packages/domain/src/supplier-detail.ts';
const directory=await mkdtemp(path.join(tmpdir(),'forge-aside-adapter-'));
const {publicKey,privateKey}=generateKeyPairSync('ed25519'),now=Date.now();
const config={directory,origin:'https://app.example.com',deviceId:randomUUID(),publicKey:publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT};
const task={version:1,id:randomUUID(),issuerOrigin:config.origin,deviceId:config.deviceId,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+240000).toISOString(),request:{kind:'supplier_search',candidateId:randomUUID(),specId:randomUUID(),inputVersion:1,settingsVersion:1,query:'stainless steel tray'}};
let adapter;
try{
 adapter=createAsideAdapter(config);
 const probe=await adapter.probe();assert.equal(probe.connected,true);
 const envelope=signBrowserTask(task,privateKey);
 await assert.rejects(adapter.collect({...envelope,signature:'a'.repeat(86)}));
 assert.equal(adapter.inspect(task.id),null);
 const exported=signBrowserTask({...task,request:{kind:'saved_search_export',searchRunId:randomUUID(),searchId:randomUUID(),revision:1,marketplace:'us',category:'Kitchen & Dining',filters:{}}},privateKey);
 assert.ok(probe.supportedTasks.includes('saved_search_export'));
 await assert.rejects(adapter.collect({...exported,signature:envelope.signature}),'A supplier signature cannot authorize an export payload');
 assert.throws(()=>signBrowserTask({...task,request:{kind:'arbitrary_shell'}},privateKey));
 assert.equal(adapter.inspect(task.id),null);
 let observedRecords=null;
 let detailFields=null;
 if(process.argv.includes('--live-detail')){
  const observed=JSON.parse(await readFile(new URL('../.omo/evidence/supplier-detail/observed-layout.json',import.meta.url),'utf8'));
  const request={kind:'supplier_detail',candidateId:randomUUID(),specId:randomUUID(),inputVersion:1,settingsVersion:1,
   sourceCaptureId:randomUUID(),companyName:observed.companyLinks[0].text,companyUrl:observed.companyLinks[0].url,productUrl:observed.sourcePageUrl};
  const detailTask={...task,id:randomUUID(),request},signed=signBrowserTask(detailTask,privateKey);
  const result=await adapter.collect(signed);
  assert.equal(result.kind,'captured','The actual ASIDE detail collector must return verified observations');
  assert.equal(result.observation.scope,'supplier_product_page');
  const capture=supplierDetailCapture(result.observation,{candidateId:request.candidateId,specId:request.specId,inputVersion:1,settingsVersion:1,searchQuery:'stainless steel tray'});
  assert.ok(capture.observedSpec.material,'Previously observed listing material remains page-backed');
  assert.equal(capture.observedSpec.dimensions,null,'Shipping package size cannot qualify product dimensions');
  assert.equal(capture.email,null,'This listing has no observed recipient email');
  assert.equal((await adapter.collect(signed)).kind,'pending_reconciliation');
  const receiptId=randomUUID();adapter.confirmServerReceipt({taskId:detailTask.id,taskHash:result.taskHash,receiptId});
  assert.equal((await adapter.collect(signed)).kind,'completed');
  detailFields={attributes:result.observation.attributes.length,materialObserved:true,productDimensionsUnknown:true,emailUnknown:true,sameTaskNotRepeated:true};
  await writeFile(new URL('../.omo/evidence/supplier-detail/live-detail.json',import.meta.url),JSON.stringify({...result,syntheticTask:true,syntheticReceipt:true,businessCandidateCreated:false},null,2));
 }
 if(process.argv.includes('--live')){
  const result=await adapter.collect(envelope);
  if(result.kind!=='captured')throw new Error('Live supplier capture unavailable: '+result.kind);
  assert.ok(result.observation.records.length>0);
  assert.equal(result.observation.query,task.request.query);
  assert.equal((await adapter.collect(envelope)).kind,'pending_reconciliation');
  const receiptId=randomUUID();
  adapter.confirmServerReceipt({taskId:task.id,taskHash:result.taskHash,receiptId});
  assert.equal((await adapter.collect(envelope)).kind,'completed');
  observedRecords=result.observation.records.length;
  await writeFile(new URL('../.omo/evidence/aside-adapter/live-capture.json',import.meta.url),JSON.stringify({...result,syntheticTask:true,businessCandidateCreated:false},null,2));
 }
 console.log(JSON.stringify({scenario:'aside-adapter',result:'PASS',actualCliProbe:true,invalidSignatureRejected:true,unsupportedTaskRejected:true,exportCapabilityAdvertised:true,liveSupplierCapture:process.argv.includes('--live'),observedRecords,liveDetail:detailFields,mainDataChanged:false,paidAgentStarted:false,supplierContactSent:false}));
}finally{
 adapter?.close();
 if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('forge-aside-adapter-'))throw new Error('UNSAFE_FIXTURE_CLEANUP');
 await rm(directory,{recursive:true,force:true});
}
