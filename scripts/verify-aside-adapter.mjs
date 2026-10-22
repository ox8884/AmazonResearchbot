import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAsideRunner} from '../apps/browser-bridge/aside-cli.mjs';
import {createAsideAdapter} from '../apps/browser-bridge/aside-adapter.mjs';
import {readAsideDecision,createdAsideSession} from '../apps/browser-bridge/aside-ai.mjs';
import {signBrowserTask} from '../apps/worker/src/browser-task-signer.ts';
import {alibabaBrowserFixture,verifyAlibabaScript} from './support/alibaba-browser-fixture.mjs';
import {supplierDetailCapture} from '../packages/domain/src/supplier-detail.ts';
import {alibabaReplyIsSafe} from '../packages/domain/src/alibaba.ts';
const directory=await mkdtemp(path.join(tmpdir(),'forge-aside-adapter-'));
const {publicKey,privateKey}=generateKeyPairSync('ed25519'),now=Date.now();
const config={directory,origin:'https://app.example.com',deviceId:randomUUID(),publicKey:publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT};
const task={version:1,id:randomUUID(),issuerOrigin:config.origin,deviceId:config.deviceId,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+240000).toISOString(),request:{kind:'supplier_search',candidateId:randomUUID(),specId:randomUUID(),inputVersion:1,settingsVersion:1,query:'stainless steel tray'}};
let adapter;
try{
 const actionId=randomUUID();
 const request={kind:'supplier_send',candidateId:randomUUID(),specId:null,inputVersion:1,settingsVersion:1,conversationId:randomUUID(),companyName:'Synthetic supplier',companyUrl:'https://synthetic.en.alibaba.com/',productUrl:'https://www.alibaba.com/product-detail/Synthetic_123.html',threadId:'123-456#11011@icbu',accountId:'456',actionId,body:'Nonbinding quote only.\nDo not order. "Quoted text" and \uD55C\uAE00. Ref '+actionId};
 const scriptChecks=await verifyAlibabaScript(request);
 const sendTask={...task,id:randomUUID(),request},sendEnvelope=signBrowserTask(sendTask,privateKey);
 const fixture=alibabaBrowserFixture();let dispatchCalls=0;
 const sendConfig={...config,directory:path.join(directory,'send'),beginDispatch:async()=>{dispatchCalls++;return {allowed:true};}};
 let sendAdapter=createAsideAdapter(sendConfig,fixture.run);
 const sent=await sendAdapter.collect(sendEnvelope);
 assert.equal(sent.kind,'captured');assert.equal(sent.observation.sendStatus,'sent');
 assert.equal(sent.observation.messages[0].body,request.body);
 assert.equal((await sendAdapter.collect(sendEnvelope)).kind,'pending_reconciliation');
 assert.equal(dispatchCalls,1);assert.equal(fixture.clicked,1);
 sendAdapter.close();
 sendAdapter=createAsideAdapter({...sendConfig,now:()=>now+300000},fixture.run);
 assert.equal((await sendAdapter.collect(sendEnvelope)).kind,'pending_reconciliation','An expired started send is reconciled without another browser execution');
 assert.equal(dispatchCalls,1);assert.equal(fixture.clicked,1);
 await assert.rejects(sendAdapter.collect({...sendEnvelope,signature:'a'.repeat(86)}));
 sendAdapter.close();
 const crashFixture=alibabaBrowserFixture(),crashConfig={...config,directory:path.join(directory,'crash'),beginDispatch:async()=>{dispatchCalls++;return {allowed:true};}};
 const crashRun=async(makeScript,options)=>{const result=await crashFixture.run(makeScript,options);if(options)throw new Error('ASIDE_EXECUTION_UNCONFIRMED');return result;};
 let crashAdapter=createAsideAdapter(crashConfig,crashRun);
 assert.equal((await crashAdapter.collect(sendEnvelope)).kind,'pending_reconciliation');
 assert.equal(crashFixture.clicked,1);
 crashAdapter.close();crashAdapter=createAsideAdapter(crashConfig,crashRun);
 assert.equal((await crashAdapter.collect(sendEnvelope)).kind,'pending_reconciliation');
 assert.equal(crashFixture.clicked,1,'Timeout after a click and process restart must never resend');
 assert.equal(dispatchCalls,2,'One dispatch authorization per separate durable send attempt');
 crashAdapter.close();
 const offlineDispatch=alibabaBrowserFixture();let failedDispatchCalls=0;
 const offlineAdapter=createAsideAdapter({...config,directory:path.join(directory,'offline-dispatch'),beginDispatch:async()=>{failedDispatchCalls++;throw Error('Connection lost after server may have authorized');}},offlineDispatch.run);
 try{
  const uncertain=await offlineAdapter.collect(sendEnvelope);
  assert.equal(uncertain.kind,'captured');assert.equal(uncertain.observation.sendStatus,'not_sent');
  assert.equal(offlineDispatch.clicked,0);assert.equal(offlineDispatch.editor,'');
  assert.equal((await offlineAdapter.collect(sendEnvelope)).kind,'pending_reconciliation');
  assert.equal(failedDispatchCalls,1,'Uncertain dispatch response must never authorize a click or a blind retry');
 }finally{offlineAdapter.close();}
 console.log(JSON.stringify({scenario:'alibaba-aside-fixture',result:'PASS',...scriptChecks,dispatchOnce:true,crashRestartNoRetry:true,dispatchNetworkFailureNoClick:true}));
 const outbound={id:'900',direction:'outbound',body:'Please quote the specified tray at 100, 300 and 500 units for comparison only.',sentAt:'2026-09-28T00:00:00.000Z'};
 const inbound={id:'901',direction:'inbound',body:'MOQ 300. USD 4.20 each at 300 units, USD 3.90 at 500. Stainless steel. Packaging and shipping extra.',sentAt:'2026-09-28T00:01:00.000Z'};
 const anchor=message=>({providerMessageId:message.id,sentAt:message.sentAt,bodySha256:createHash('sha256').update(message.body).digest('hex')});
 const thread={...request,kind:'supplier_thread',negotiation:{keyword:'stainless steel tray',specification:'Stainless steel tray; dimensions unknown.',lastOutbound:anchor(outbound),round:1}};
 delete thread.actionId;delete thread.body;
 const execution={sessionId:'synthetic_session',provider:'fixture',model:'fixture-model'},reply={kind:'reply',body:'Could you quote 100 units for comparison and your best unit price for 300 and 500 units? Please clarify packaging and shipping costs.'};
 for(const scenario of [
  {name:'reply',records:[inbound,outbound],response:{decision:reply,execution},kind:'reply',calls:1},
  {name:'sample-prohibition-at-this-stage',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Please do not send a sample at this stage.'},execution},kind:'reply',calls:1},
  {name:'sample-at-this-stage-until-payment',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Please do not send a sample at this stage until payment.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'sample-at-this-stage-then-send',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Please do not send a sample at this stage, then send a sample.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'sample-at-this-stage-positive',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Please send a sample at this stage.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'sample-at-this-stage-conditional',records:[inbound,outbound],response:{decision:{kind:'reply',body:'If payment clears, do not send a sample at this stage.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'production-prohibition',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Could you itemize shipping? Please do not start production or ship anything.'},execution},kind:'reply',calls:1},
  {name:'not-asking-production',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Could you itemize shipping? We are not asking you to start production or ship anything.'},execution},kind:'reply',calls:1},
  {name:'combined-prohibition',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Please quote sample cost only; do not send a sample, and please do not start production or ship anything.'},execution},kind:'reply',calls:1},
  {name:'not-asking-until-payment',records:[inbound,outbound],response:{decision:{kind:'reply',body:'We are not asking you to start production or ship anything until payment.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'not-asking-unless-payment',records:[inbound,outbound],response:{decision:{kind:'reply',body:'We are not asking you to start production or ship anything unless we pay.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'combined-until-payment',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Do not send a sample, and please do not start production or ship anything until payment.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'combined-unless-payment',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Do not send a sample, and please do not start production or ship anything unless we pay.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'combined-positive-production',records:[inbound,outbound],response:{decision:{kind:'reply',body:'Do not send a sample, and please start production.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
  {name:'no-inbound',records:[outbound],calls:0},
  {name:'equal-time',records:[{...inbound,sentAt:outbound.sentAt},outbound],calls:0},
  {name:'oversized-unicode',records:[{...inbound,body:'\uac00'.repeat(9000)},outbound],reason:'NEGOTIATION_CONTEXT_TOO_LARGE',calls:0},
  {name:'missing-anchor',records:[inbound],reason:'NEGOTIATION_REQUIRES_REVIEW',calls:0},
  {name:'edited-anchor',records:[inbound,{...outbound,body:'Different outbound'}],reason:'NEGOTIATION_REQUIRES_REVIEW',calls:0},
  {name:'unknown-outbound',records:[inbound,outbound,{...outbound,id:'902',sentAt:'2026-09-28T00:02:00.000Z'}],reason:'NEGOTIATION_REQUIRES_REVIEW',calls:0},
  {name:'oversized',records:[{...inbound,body:'x'.repeat(25000)},outbound],reason:'NEGOTIATION_CONTEXT_TOO_LARGE',calls:0},
  {name:'binding',records:[{...inbound,body:'Please pay the deposit.'},outbound],reason:'BINDING_REQUEST_REQUIRES_REVIEW',calls:0},
  {name:'ai-failure',records:[inbound,outbound],error:'AI_UNAVAILABLE',reason:'AI_UNAVAILABLE',calls:1},
  {name:'unsafe-reply',records:[inbound,outbound],response:{decision:{kind:'reply',body:'We accept the offer.'},execution},reason:'AI_RESPONSE_INVALID',calls:1},
 ]){
  let calls=0;const browser=alibabaBrowserFixture({records:scenario.records});
  const local=createAsideAdapter({...config,directory:path.join(directory,scenario.name)},browser.run,async(prompt,{deadline})=>{
   calls++;assert.ok(deadline<=Date.parse(task.expiresAt)-15000);assert.ok(prompt.includes(inbound.body));
   if(scenario.error)throw Error(scenario.error);return scenario.response;
  });
  try{
   const result=await local.collect(signBrowserTask({...task,id:randomUUID(),request:thread},privateKey));
   assert.equal(result.kind,'captured');assert.equal(result.observation.messages.length,scenario.records.length);
   assert.equal(calls,scenario.calls,scenario.name);assert.equal(browser.clicked,0);
   if(scenario.kind)assert.equal(result.observation.proposal.decision.kind,scenario.kind);
   else if(scenario.reason)assert.equal(result.observation.proposal.decision.reason,scenario.reason);
   else assert.equal(result.observation.proposal,undefined);
  }finally{local.close();}
 }
 console.log(JSON.stringify({scenario:'aside-negotiation-fixture',result:'PASS',actualModelCalls:0}));

 assert.equal(createdAsideSession('created new session: partial'),undefined);
 assert.equal(createdAsideSession('created new session: partialCompleted\n'),'partialCompleted');
 const model={provider:'fixture',modelId:'fixture-model',thinkingLevel:'high',fastMode:false},session={id:'fixture_session',status:'idle',model};
 const user={role:'user',content:[{type:'text',text:'synthetic prompt'}]},final={role:'assistant',provider:model.provider,model:model.modelId,stopReason:'stop',content:[{type:'thinking',thinking:'Private reasoning must not enter the draft'},{type:'text',text:JSON.stringify(reply)}]};
 assert.deepEqual(readAsideDecision([{role:'system-message',content:'Runtime initialization'},user,final],session,model,'synthetic prompt').decision,reply);
 const fence=String.fromCharCode(96).repeat(3);
 assert.deepEqual(readAsideDecision([user,{...final,content:[{type:'text',text:fence+'json\n'+JSON.stringify(reply)+'\n'+fence}]}],session,model,'synthetic prompt').decision,reply);
 for(const messages of [
  [user,{...final,content:[{type:'text',text:'Explanation\n'+JSON.stringify(reply)}]}],
  [user,{...final,content:[{type:'text',text:'{"kind":"reply","body":"Fine","extra":true}'}]}],
  [user,{...final,stopReason:'error',errorMessage:'PRIVATE_AUTH_DETAIL'}],
  [user,{...final,stopReason:'length'}],
  [user,{...final,model:'different-model'}],
  [user,{role:'toolResult',isError:true},final],
  [user,{role:'assistant',content:[{type:'toolCall',name:'repl'}]},final],
  [user,user,final],
  [user,{role:'unexpected',content:[]},final],
  [user,{role:'assistant',stopReason:'error',content:[]},final],
 ])assert.throws(()=>readAsideDecision(messages,session,model,'synthetic prompt'),/AI_RESPONSE_INVALID/);
 assert.throws(()=>readAsideDecision([user,final],{...session,status:'running'},model,'synthetic prompt'),/AI_RESPONSE_INVALID/);
 const parseText=text=>readAsideDecision([user,{...final,content:[{type:'text',text}]}],session,model,'synthetic prompt').decision;
 const rawBody=body=>'{"kind":"reply","body":"'+body+'"}';
 for(const [body,expectedBody] of [
  ['Please quote.\nPlease itemize shipping.','Please quote.\nPlease itemize shipping.'],
  ['Please quote.\r\nPlease itemize shipping.','Please quote.\r\nPlease itemize shipping.'],
  ['Please quote.\tPlease itemize shipping.','Please quote.\tPlease itemize shipping.'],
  [String.raw`Quoted \"text\" and \\ path`+'\nPlease quote.','Quoted "text" and \\ path\nPlease quote.'],
  [String.raw`Path \\`+'\nPlease quote.','Path \\\nPlease quote.'],
 ]){
  assert.deepEqual(parseText(rawBody(body)),{kind:'reply',body:expectedBody},'Only literal string whitespace is escaped, preserving decoded content');
  assert.deepEqual(parseText(fence+'json\n'+rawBody(body)+'\n'+fence),{kind:'reply',body:expectedBody});
 }
 for(const body of ['Please quote.\rPlease itemize shipping.',String.raw`Literal \n and \t`,'Escaped "quote" and \\ path'])assert.deepEqual(parseText(JSON.stringify({kind:'reply',body})),{kind:'reply',body});
 assert.deepEqual(parseText('{"kind":"review","reason":"NEGOTIATION_REQUIRES_REVIEW"}'),{kind:'review',reason:'NEGOTIATION_REQUIRES_REVIEW'});
 for(const text of [
  rawBody('Bad\\\nline'),rawBody('Bad\\\rline'),rawBody('Bad\\\tline'),
  rawBody('Bad\u0000line'),rawBody('Bad\u000bline'),rawBody('Bad\u000cline'),rawBody('Bad\u001fline'),
  rawBody('Unescaped "quote"\nline'),rawBody('Invalid\\q\nline'),
  '{"kind":"reply","body":"Fine\nline",}',rawBody('Fine\nline')+' trailing',
  '{"kind":"reply","body":"Fine\nline","extra":true}','{"kind":"reply",'+' '.repeat(32769)+'"body":"Fine\nline"}',rawBody('x'.repeat(3000)+'\nend'),
 ])assert.throws(()=>parseText(text),/AI_RESPONSE_INVALID/,'Other malformed text must stay rejected');
 for(const body of ['We accept\nthe offer.','Please start\tproduction.'])assert.equal(alibabaReplyIsSafe(parseText(rawBody(body)).body),false,'Normalized whitespace cannot bypass reply safety');
 const malformedFinal={...final,content:[{type:'text',text:rawBody('Please quote.\nPlease itemize shipping.')} ]};
 assert.throws(()=>readAsideDecision([user,malformedFinal],session,model,'different prompt'),/AI_RESPONSE_INVALID/);
 assert.throws(()=>readAsideDecision([user,malformedFinal],{...session,model:{...model,modelId:'other'}},model,'synthetic prompt'),/AI_RESPONSE_INVALID/);
 assert.throws(()=>readAsideDecision([user,{role:'assistant',content:[{type:'toolCall',name:'repl'}]},malformedFinal],session,model,'synthetic prompt'),/AI_RESPONSE_INVALID/);
 const unsafeBrowser=alibabaBrowserFixture({records:[inbound,outbound]});
 const unsafeAdapter=createAsideAdapter({...config,directory:path.join(directory,'raw-whitespace-unsafe')},unsafeBrowser.run,async prompt=>readAsideDecision(
  [{...user,content:[{type:'text',text:prompt}]},{...final,content:[{type:'text',text:rawBody('We accept\nthe offer.')}]}],session,model,prompt));
 try{
  const result=await unsafeAdapter.collect(signBrowserTask({...task,id:randomUUID(),request:thread},privateKey));
  assert.equal(result.observation.proposal.decision.reason,'AI_RESPONSE_INVALID');assert.equal(unsafeBrowser.clicked,0);
 }finally{unsafeAdapter.close();}
 console.log(JSON.stringify({scenario:'aside-ai-json-whitespace',result:'PASS',contentPreserved:true,strictSchema:true,safetyPreserved:true,provenancePreserved:true}));
 if(process.argv.includes('--live-negotiation')){
  const browser=alibabaBrowserFixture({records:[inbound,outbound]});
  const live=createAsideAdapter({...config,directory:path.join(directory,'live-negotiation')},browser.run);
  try{
   const result=await live.collect(signBrowserTask({...task,id:randomUUID(),request:thread},privateKey));
   assert.equal(result.kind,'captured');assert.equal(result.observation.sendStatus,'read');assert.equal(browser.clicked,0);
   const proposal=result.observation.proposal;
   assert.equal(proposal?.decision.kind,'reply',JSON.stringify(proposal));
   assert.ok(proposal.execution?.sessionId);assert.notEqual(proposal.execution.provider,'fixture');
   const evidence={...proposal,synthetic:true,supplierContactSent:false,request:thread,messages:[inbound,outbound],observedAt:new Date().toISOString()};
   const file=new URL('../.codexclaw/evidence/aside-live-negotiation.json',import.meta.url);
   await mkdir(new URL('.',file),{recursive:true});await writeFile(file,JSON.stringify(evidence,null,2)+'\n');
   console.log(JSON.stringify({scenario:'aside-live-negotiation',result:'PASS',execution:proposal.execution,body:proposal.decision.body,supplierContactSent:false}));
  }finally{live.close();}
 }

 const sourceValue=String.raw`한글 "quotes" \n \\ path`;
 async function roundTrip(marker,value){
  console.log(marker+JSON.stringify({protocol:1,value,valid:/^https:\/\/m\.media-amazon\.com\/images\/[^?#\s\\]+$/.test('https://m.media-amazon.com/images/test.jpg')}));
 }
 const sourceResult=await createAsideRunner(config)(marker=>'await ('+roundTrip.toString()+')('+JSON.stringify(marker)+','+JSON.stringify(sourceValue)+')');
 assert.equal(sourceResult.valid,true,'Actual Aside execution must preserve regular-expression backslashes');
 assert.equal(sourceResult.value,sourceValue,'Actual Aside execution must preserve quoted Unicode and literal backslashes');
 adapter=createAsideAdapter(config);
 const probe=await adapter.probe();assert.equal(probe.connected,true);
 assert.ok(probe.supportedTasks.includes('supplier_send'));
 process.env.FORGE_ALIBABA_SENDS_PAUSED='1';
 let paused;
 try{
  paused=createAsideAdapter(config);
  assert.ok(!(await paused.probe()).supportedTasks.includes('supplier_send'),'A paused bridge does not advertise sends');
  const pausedSend=signBrowserTask({...sendTask,id:randomUUID(),issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+240000).toISOString()},privateKey);
  assert.equal((await paused.collect(pausedSend)).kind,'unavailable','A paused bridge never runs a send');
 }finally{delete process.env.FORGE_ALIBABA_SENDS_PAUSED;paused?.close();}
 const envelope=signBrowserTask(task,privateKey);
 await assert.rejects(adapter.collect({...envelope,signature:'a'.repeat(86)}));
 assert.equal(adapter.inspect(task.id),null);
 const exported=signBrowserTask({...task,request:{kind:'saved_search_export',searchRunId:randomUUID(),searchId:randomUUID(),revision:1,marketplace:'us',category:'Kitchen & Dining',filters:{}}},privateKey);
 assert.ok(probe.supportedTasks.includes('saved_search_export'));
 await assert.rejects(adapter.collect({...exported,signature:envelope.signature}),'A supplier signature cannot authorize an export payload');
 assert.throws(()=>signBrowserTask({...task,request:{kind:'arbitrary_shell'}},privateKey));
 assert.equal(adapter.inspect(task.id),null);
 if(process.argv.includes('--live-thread')){
  const request=JSON.parse(await readFile(process.env.FORGE_ALIBABA_THREAD_FIXTURE,'utf8'));
  assert.equal(request.kind,'supplier_thread','The live check is read-only');
  const signed=signBrowserTask({...task,id:randomUUID(),request},privateKey);
  const result=await adapter.collect(signed);
  assert.equal(result.kind,'captured',JSON.stringify(result));
  assert.equal(result.observation.sendStatus,'read');
  assert.equal(result.observation.actionId,null);
  if(process.argv.includes('--live-prepare')){
   let deniedAuthorizations=0;
   const safe=createAsideAdapter({...config,beginDispatch:async()=>{deniedAuthorizations++;return {allowed:false,reason:'READ_ONLY_PROBE'};}});
   try{
    const actionId=randomUUID(),sendRequest={...request,kind:'supplier_send',threadId:result.observation.threadId,accountId:result.observation.accountId,actionId,body:'Nonbinding sourcing inquiry preparation. Ref '+actionId};
    const prepared=await safe.collect(signBrowserTask({...task,id:randomUUID(),request:sendRequest},privateKey));
    assert.equal(prepared.kind,'captured',JSON.stringify(prepared));assert.equal(prepared.observation.sendStatus,'not_sent');assert.equal(prepared.observation.reason,'READ_ONLY_PROBE');
    assert.equal(deniedAuthorizations,1);assert.deepEqual(prepared.observation.messages.map(message=>message.id),result.observation.messages.map(message=>message.id));
    assert.ok(!prepared.observation.snapshot.includes('chatToken='));assert.equal(prepared.observation.sourcePageUrl,'https://message.alibaba.com/message/messenger.htm');
    console.log(JSON.stringify({scenario:'alibaba-aside-live-first-send-preparation',result:'PASS',dispatchExplicitlyDenied:true,messageIdsUnchanged:true,transientUrlRedacted:true,supplierContactSent:false}));
   }finally{safe.close();}
  }
  console.log(JSON.stringify({scenario:'alibaba-aside-live-read',result:'PASS',observedMessages:result.observation.messages.length,companyIdentityVerified:true,supplierContactSent:false}));
 }
 if(process.argv.includes('--live-production-prepare')){
  const request=JSON.parse(await readFile(process.env.FORGE_ALIBABA_SEND_FIXTURE,'utf8'));
  assert.equal(request.kind,'supplier_send');let dispatchDenials=0,readyDiagnostics,cleanupDiagnostics;
  const realRunner=createAsideRunner(config);
  const instrumented=async(makeScript,options)=>{
   const result=await realRunner(marker=>{
    let source=makeScript(marker).replace("const existing=(await listBrowserTabs()).find(tab=>tab.url.split('#')[0]===url.split('#')[0]);",'const existing=null;');
    const probe="async function probeUI(){return p.locator('body').evaluate((b,expected)=>({bodyExact:b.querySelector('textarea.send-textarea').value===expected,length:b.querySelector('textarea.send-textarea').value.length,buttons:Array.from(b.querySelectorAll('button.send-tool-button')).map(el=>({gray:el.classList.contains('gray'),disabled:el.disabled}))}),request.body);}";
    source=source.replace('async function cleanup(){',()=>probe+'async function cleanup(){')
     .replace('for(const tab of owned.reverse())await closeTab(tab);',()=>"if(filled&&!clicked&&p)globalThis.forgeCleanupProbe=await probeUI();for(const tab of owned.reverse())await closeTab(tab);")
     .replace("emit({protocol:1,kind:'ready',observation});",()=>"emit({protocol:1,kind:'ready',observation,probeReady:await probeUI()});")
     .replace('await cleanup();emit(result);',()=>"await cleanup();emit({...result,probeCleanup:globalThis.forgeCleanupProbe});");
    return source;
   },options?{...options,onReady:async ready=>{readyDiagnostics=ready.probeReady;return options.onReady(ready);}}:undefined);
   cleanupDiagnostics=result.probeCleanup;delete result.probeCleanup;return result;
  };
  const safe=createAsideAdapter({...config,directory:path.join(directory,'production-prepare'),beginDispatch:async()=>{dispatchDenials++;return {allowed:false,reason:'READ_ONLY_PROBE'};}},instrumented);
  try{
   const result=await safe.collect(signBrowserTask({...task,id:randomUUID(),request},privateKey));
   assert.equal(result.kind,'captured',JSON.stringify(result));assert.equal(result.observation.sendStatus,'not_sent');assert.equal(result.observation.reason,'READ_ONLY_PROBE');assert.equal(dispatchDenials,1);
   assert.equal(readyDiagnostics.bodyExact,true);assert.equal(readyDiagnostics.length,request.body.length);assert.deepEqual(readyDiagnostics.buttons,[{gray:false,disabled:false}]);
   assert.equal(cleanupDiagnostics.length,0);assert.deepEqual(cleanupDiagnostics.buttons,[{gray:true,disabled:false}]);
   assert.ok(!result.observation.messages.some(message=>message.direction==='outbound'&&message.body===request.body));
   console.log(JSON.stringify({scenario:'alibaba-production-body-preparation',result:'PASS',bodyLength:request.body.length,bodyLines:request.body.split(String.fromCharCode(10)).length,exactBody:true,readyBeforeDispatch:true,dispatchExplicitlyDenied:true,draftEmpty:true,emptyButtonGray:true,supplierContactSent:false}));
  }finally{safe.close();}
 }
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
