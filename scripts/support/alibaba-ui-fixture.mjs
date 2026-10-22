import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {browserSigningFixture} from './browser-signing-fixture.mjs';
import {orderValidationFixture} from './order-market-fixture.mjs';
import {publishBrowserSigningIdentity} from '../../apps/worker/src/browser-signing-key.ts';
import {queueSupplierSearch} from '../../apps/worker/src/browser-task-producer.ts';
import {prepareAlibabaActions,queueAlibabaTask} from '../../apps/worker/src/alibaba-scheduler.ts';

export async function alibabaUiFixture(test,webOrigin){
 const liveProposal=process.env.FORGE_ALIBABA_AI_PROPOSAL_FILE?JSON.parse(await readFile(process.env.FORGE_ALIBABA_AI_PROPOSAL_FILE,'utf8')):null;
 const encryptionKey=Buffer.from(test.encryptionKeyHex,'hex');
 const settings=(await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'alibaba-ui-fixture',snapshot || '{\"supplierContactMode\":\"website\"}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1 RETURNING version,snapshot")).rows[0];
 const keyword=liveProposal?liveProposal.request.negotiation.keyword:'합성 실리콘 주걱 · Alibaba 자동 연락 검증';
 const candidateId=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",[keyword])).rows[0].id;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale) VALUES($1,$2,'api_validation','pass',$3::jsonb,false)",[candidateId,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot))]);
 const keys=browserSigningFixture(),identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const signing={origin:webOrigin,privateKey:keys.privateKey,fingerprint:identity.fingerprint};
 const pairing=await test.call('/api/bridge/pairings',{});
 const device=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'합성 Alibaba UI 검증 PC'});assert.equal(device.status,201);
 const machine=(url,body)=>test.call(url,body,{authorization:'Bearer '+device.body.credential});
 const report=async connected=>assert.equal((await machine('/api/bridge/capabilities',{connected,supportedTasks:['supplier_search','supplier_thread','supplier_send'],keyFingerprint:identity.fingerprint})).status,200);
 await report(true);
 const claim=async queued=>{
  assert.equal(queued.kind,'queued');
  const response=await machine('/api/bridge/tasks/claim',{});assert.equal(response.status,200);assert.equal(response.body.taskId,queued.taskId);
  return response.body;
 };
 const result=async(task,observation)=>{
  const response=await machine(`/api/bridge/tasks/${task.taskId}/results`,{taskHash:task.taskHash,observation});
  assert.equal(response.status,201,JSON.stringify(response.body));return response.body;
 };
 const search=await claim(await queueSupplierSearch(test.pool,{deviceId:device.body.id,candidateId},signing));
 const source={companyName:'합성 공급처 · Synthetic Kitchenware Company',companyUrl:'https://synthetic-ui.en.alibaba.com',productName:liveProposal?'Synthetic '+keyword:'Synthetic silicone spatula',productUrl:liveProposal?liveProposal.request.productUrl:'https://www.alibaba.com/product-detail/Synthetic-silicone-spatula_1600123456789.html'};
 await result(search,{protocol:1,kind:'captured',scope:'first_results_page',sourcePageUrl:'https://www.alibaba.com/trade/search?SearchText='+encodeURIComponent(keyword),query:keyword,observedAt:new Date().toISOString(),snapshot:'Synthetic supplier search, no external page was opened',visibleCards:1,records:[{...source,pageText:`${source.companyName} ${source.productName} Synthetic UI fixture only`}]});
 const conversationId=(await test.pool.query('SELECT id FROM alibaba_conversations WHERE candidate_id=$1',[candidateId])).rows[0].id;
 const messages=[];
 const observation=(actionId=null,sendStatus='read')=>({protocol:1,kind:'captured',scope:'alibaba_thread',conversationId,actionId,companyName:source.companyName,companyUrl:source.companyUrl,productUrl:source.productUrl,threadId:'synthetic-ui-'+test.runId,accountId:'900000001',sourcePageUrl:'https://message.alibaba.com/message/messenger.htm',observedAt:new Date().toISOString(),snapshot:'Synthetic Alibaba UI conversation; no external send',messages:[...messages],sendStatus,reason:null});
 const read=async(proposal)=>result(await claim(await queueAlibabaTask(test.pool,{deviceId:device.body.id,conversationId,encryptionKey},signing)),{...observation(),...(proposal?{proposal}:{})});
 await read();assert.equal(await prepareAlibabaActions(test.pool,encryptionKey),1);
 const first=(await test.call(`/api/candidates/${candidateId}/contact`)).body.website.conversations[0].actions[0];
 const send=await claim(await queueAlibabaTask(test.pool,{deviceId:device.body.id,conversationId,actionId:first.id,encryptionKey},signing));
 assert.equal((await machine(`/api/bridge/tasks/${send.taskId}/dispatch`,{taskHash:send.taskHash})).body.allowed,true);
 messages.push({id:'synthetic-outbound-1',direction:'outbound',body:first.body,sentAt:new Date().toISOString()});
 await result(send,observation(first.id,'sent'));
 await new Promise(resolve=>setTimeout(resolve,5));
 const incoming=liveProposal?liveProposal.messages.filter(message=>message.direction==='inbound').at(-1)?.body:'Synthetic supplier reply only.\nMOQ: 300 sale units. Unit price: USD 4.80. Packaging included.\nFreight, duties and DDP are unconfirmed. Lead time: 25 days.\n<script>window.syntheticSupplierScriptRan=true</script>';
 assert.equal(typeof incoming,'string');
 messages.push({id:'synthetic-inbound-1',direction:'inbound',body:incoming,sentAt:new Date().toISOString()});
 const inbound=messages.at(-1);
 await read({basedOnInbound:{providerMessageId:inbound.id,sentAt:inbound.sentAt,bodySha256:createHash('sha256').update(inbound.body).digest('hex')},decision:liveProposal?liveProposal.decision:{kind:'reply',body:'Could you quote a lower MOQ and clarify freight, duties and DDP delivery for comparison?'},execution:liveProposal?liveProposal.execution:{sessionId:'synthetic-ui-ai',provider:'synthetic-provider',model:'synthetic-model'}});
 assert.equal(await prepareAlibabaActions(test.pool,encryptionKey),0);
 const workspace=async()=>(await test.call(`/api/candidates/${candidateId}/contact`)).body.website;
 const initial=await workspace();
 assert.equal(initial.status,'negotiating');assert.equal(initial.conversations[0].messages.length,2);
 assert.deepEqual(initial.conversations[0].actions.map(action=>action.state),['sent','pending']);
 assert.equal((await test.pool.query('SELECT count(*)::int AS count FROM spec_revisions WHERE candidate_id=$1',[candidateId])).rows[0].count,0);
 await read();assert.equal((await workspace()).lastActivityAt,initial.lastActivityAt,'Unchanged reads must not invent new activity');
 let connected=true;
 const heartbeat=setInterval(()=>{void report(connected).catch(error=>console.error('Synthetic heartbeat failed:',error.message));},30000);
 return {candidateId,conversationId,entryPath:`/candidates/${candidateId}/contact`,initial,
  async setState(state){
   if(state==='alibaba-offline'||state==='alibaba-online'){connected=state==='alibaba-online';await report(connected);}
   else if(state==='alibaba-unknown'){
    const pending=(await workspace()).conversations[0].actions.find(action=>action.state==='pending');assert.ok(pending);
    const task=await claim(await queueAlibabaTask(test.pool,{deviceId:device.body.id,conversationId,actionId:pending.id,encryptionKey},signing));
    assert.equal((await machine(`/api/bridge/tasks/${task.taskId}/dispatch`,{taskHash:task.taskHash})).body.allowed,true);
    await result(task,observation(pending.id,'unknown'));
   }else if(state==='alibaba-email'){
    await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'alibaba-ui-email-regression',snapshot-'supplierContactMode' FROM settings_versions ORDER BY version DESC LIMIT 1");
   }else return false;
   const current=await workspace();
   if(state==='alibaba-offline'){assert.equal(current.status,'paused');assert.equal(current.reason,'BROWSER_OFFLINE');}
   if(state==='alibaba-unknown')assert.equal(current.conversations[0].actions.at(-1).state,'outcome_unknown');
   if(state==='alibaba-email')assert.equal(current.enabled,false);
   console.log(JSON.stringify({fixtureState:state,website:current}));return true;
  },close(){clearInterval(heartbeat);},
 };
}
