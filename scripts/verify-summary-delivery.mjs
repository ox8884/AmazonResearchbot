import {runSummaryDeliveryCycle} from "../apps/worker/src/summary-delivery-loop.ts";
import {createMailpitTransport} from "../packages/integrations/src/mail/mailpit.ts";
import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {prepareSummaryDelivery,dispatchSummaryDelivery,recoverSummaryDeliveries,reconcileSummaryDelivery} from '../apps/worker/src/summary-delivery.ts';
import {buildDailySummary} from '../packages/db/src/daily-summary.ts';
import {randomUUID} from 'node:crypto';
import {createComposioGmailTransport} from '../packages/integrations/src/mail/composio.ts';
import {resolveSummaryMailTransport} from '../apps/worker/src/summary-mail.ts';
import {createHash} from 'node:crypto';
const test=await openAcceptance({databaseKey:'summary-delivery-'+Date.now()});
let sends=0;
const localMail=createMailpitTransport('development');
const mail={...localMail,send:async(payload,id)=>{sends++;assert.equal(payload.recipient,'jay@fixture.invalid');return localMail.send(payload,id);}};
async function createSummary(test){
 const now=new Date(),setting=(await test.call('/api/settings')).body;
 const db=await test.pool.connect();let payload;try{payload=await buildDailySummary(db,now,setting.snapshot);}finally{db.release();}
 const id=randomUUID(),run=randomUUID();
 const day=(await test.pool.query('SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS day',[now,setting.snapshot.timezone])).rows[0].day;
 await test.pool.query("INSERT INTO daily_runs(id,schedule,local_date,timezone,settings_version,generated_at,result) VALUES($1,'summary',$2,$3,$4,$5,'{}')",[run,day,setting.snapshot.timezone,setting.version,now]);
 await test.pool.query('INSERT INTO daily_summaries(id,run_id,local_date,timezone,settings_version,generated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,run,day,setting.snapshot.timezone,setting.version,now,JSON.stringify(payload)]);
 return id;
}
try{
 assert.equal((await test.call('/api/settings/proposals',{summaryEmailEnabled:true})).status,400);
 const proposal=await test.call('/api/settings/proposals',{summaryEmail:'jay@fixture.invalid',summaryEmailEnabled:true});assert.equal(proposal.status,201);
 assert.notEqual((await test.call('/api/settings')).body.snapshot.summaryEmailEnabled,true);
 assert.equal((await test.call(`/api/approvals/${proposal.body.approvalId}/approve`,{})).status,200);
 const summaryId=await createSummary(test);
 const ids=await Promise.all([prepareSummaryDelivery(test.pool,summaryId),prepareSummaryDelivery(test.pool,summaryId)]);assert.ok(ids[0]);assert.equal(ids[0],ids[1]);
 assert.equal(await dispatchSummaryDelivery(test.pool,ids[0],null),'skipped');assert.equal(sends,0);
 const results=await Promise.all([dispatchSummaryDelivery(test.pool,ids[0],mail),dispatchSummaryDelivery(test.pool,ids[0],mail)]);
 assert.deepEqual(results.sort(),['sent','skipped']);assert.equal(sends,1);
 assert.equal(await dispatchSummaryDelivery(test.pool,ids[0],mail),'skipped');assert.equal(sends,1);
 const delivery=(await test.pool.query('SELECT recipient,subject,body FROM summary_deliveries WHERE id=$1',[ids[0]])).rows[0];
 assert.equal((await localMail.reconcile(delivery,ids[0])).kind,'sent','Local SMTP capture must match exact recipient and body');
 const view=await test.call('/api/summaries/'+summaryId);assert.equal(view.body.delivery.state,'sent');assert.equal(view.body.delivery.localCapture,true);assert.equal(view.body.delivery.recipient,'jay@fixture.invalid');
 assert.equal((await test.pool.query('SELECT payload FROM daily_summaries WHERE id=$1',[summaryId])).rows[0].payload.delivery,'not_sent','Immutable generation snapshot must remain unchanged');
 console.log(JSON.stringify({scenario:'summary-delivery',result:'PASS',approvedRecipient:true,disabledNoSend:true,concurrentOnce:true,immutableSummary:true,syntheticSends:sends}));
}finally{await test.close();}

for(const mode of ['changed','unknown','recovery','recipient','legacy','disabled-change']){
 const scope=await openAcceptance({databaseKey:'summary-'+mode+'-'+Date.now()});let submitted=0;
 try{
  const legacySummary=mode==='legacy'?await createSummary(scope):null;
  const consent=await scope.call('/api/settings/proposals',{summaryEmail:'jay@fixture.invalid',summaryEmailEnabled:true});assert.equal((await scope.call(`/api/approvals/${consent.body.approvalId}/approve`,{})).status,200);
  if(legacySummary){assert.equal(await prepareSummaryDelivery(scope.pool,legacySummary),null,'Approval must not send summaries generated before consent');console.log(JSON.stringify({scenario:'summary-legacy',result:'PASS',submitted:0}));continue;}
  const summary=await createSummary(scope),id=await prepareSummaryDelivery(scope.pool,summary);assert.ok(id);
  const transport={name:'synthetic',authorize:async()=>({allowed:true}),send:async()=>{submitted++;throw new Error('PRIVATE_SMTP_SENTINEL');}};
  if(mode==='changed'){
   transport.authorize=async()=>{const change=await scope.call('/api/settings/proposals',{summaryEmail:'other@fixture.invalid'});assert.equal((await scope.call(`/api/approvals/${change.body.approvalId}/approve`,{})).status,200);return {allowed:true};};
   assert.equal(await dispatchSummaryDelivery(scope.pool,id,transport),'skipped');assert.equal(submitted,0);
   assert.equal((await scope.pool.query('SELECT state FROM summary_deliveries WHERE id=$1',[id])).rows[0].state,'cancelled');
  }else if(mode==='disabled-change'){
   const change=await scope.call('/api/settings/proposals',{summaryEmailEnabled:false});assert.equal((await scope.call(`/api/approvals/${change.body.approvalId}/approve`,{})).status,200);
   let lookups=0;await runSummaryDeliveryCycle(scope.pool,async()=>{lookups++;return null;});
   assert.equal((await scope.pool.query('SELECT state FROM summary_deliveries WHERE id=$1',[id])).rows[0].state,'cancelled');assert.equal(lookups,0,'Stale pending cancellation must finish before any transport lookup');assert.equal(submitted,0);
  }else if(mode==='recipient'){
   transport.send=async()=>{submitted++;return {kind:'not_sent',reason:'MAIL_SMTP_RECIPIENT_REJECTED'};};
   assert.equal(await dispatchSummaryDelivery(scope.pool,id,transport),'blocked');assert.equal(await dispatchSummaryDelivery(scope.pool,id,transport),'skipped');assert.equal(submitted,1);
   assert.equal((await scope.pool.query('SELECT state FROM summary_deliveries WHERE id=$1',[id])).rows[0].state,'cancelled');
  }else{
   if(mode==='recovery'){
    await scope.pool.query("UPDATE summary_deliveries SET state='dispatching',started_at=now()-interval '6 minutes',attempt_count=1 WHERE id=$1",[id]);await recoverSummaryDeliveries(scope.pool);
   }else assert.equal(await dispatchSummaryDelivery(scope.pool,id,transport),'unknown');
   const beforeRepeat=submitted;assert.equal(await dispatchSummaryDelivery(scope.pool,id,transport),'skipped');assert.equal(submitted,beforeRepeat);
   await assert.rejects(scope.pool.query("UPDATE summary_deliveries SET state='pending' WHERE id=$1",[id]),/cannot be retried/);
   assert.equal(await reconcileSummaryDelivery(scope.pool,id,{...transport,reconcile:async()=>({kind:'sent',messageId:'verified-synthetic',receipt:'synthetic sent-folder match'})}),true);assert.equal(submitted,beforeRepeat);
  }
  console.log(JSON.stringify({scenario:'summary-'+mode,result:'PASS',submitted}));
 }finally{await scope.close();}
}

{
 const scope=await openAcceptance({databaseKey:'summary-composio-access-'+Date.now()});
 const apiKey='approved-composio-key';
 try{
  const consent=await scope.call('/api/settings/proposals',{summaryEmail:scope.authFixture.email,summaryEmailEnabled:true});
  assert.equal((await scope.call(`/api/approvals/${consent.body.approvalId}/approve`,{})).status,200);
  const user=(await scope.pool.query('SELECT id FROM "user" WHERE lower(email)=lower($1)',[scope.authFixture.email])).rows[0];assert.ok(user?.id);
  const fingerprint=createHash('sha256').update('mcp-v1:'+apiKey).digest('hex');
  await scope.pool.query("INSERT INTO composio_gmail_connections(user_id,key_fingerprint,session_ciphertext,mcp_ciphertext,account_id,status,email,checked_at) VALUES($1,$2,'fixture-session','fixture-mcp','account-fixture','active',$3,now())",[user.id,fingerprint,scope.authFixture.email]);
  const transport=await resolveSummaryMailTransport(scope.pool,Buffer.from(scope.encryptionKeyHex,'hex'),'development','disabled','composio',apiKey,async()=>{throw new Error('WIRE_NOT_USED');});
  assert.equal(transport?.name,'composio-gmail');
  assert.deepEqual(await transport?.authorize({recipient:scope.authFixture.email,subject:'Summary',body:'Body'}),{allowed:true});
  const changed=await scope.call('/api/settings/proposals',{summaryEmailEnabled:false});assert.equal((await scope.call(`/api/approvals/${changed.body.approvalId}/approve`,{})).status,200);
  assert.deepEqual(await transport?.authorize({recipient:scope.authFixture.email,subject:'Summary',body:'Body'}),{allowed:false,reason:'COMPOSIO_CONNECTION_CHANGED'});
  console.log(JSON.stringify({scenario:'summary-composio-access',result:'PASS',staleApprovalBlocked:true}));
 }finally{await scope.close();}
}

{
 let requestCount=0;
 const wire=async({body})=>{
  requestCount++;
  const request=JSON.parse(body);
  if(request.method==='initialize')return {status:200,body:{jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-03-26'}} ,mcpSessionId:'summary-session'};
  if(request.method==='notifications/initialized')return {status:202,body:null};
  assert.equal(request.params.name,'COMPOSIO_MULTI_EXECUTE_TOOL');
  const [tool]=request.params.arguments.tools;
  assert.equal(tool.tool_slug,'GMAIL_SEND_EMAIL');
  assert.equal(tool.account,'account-fixture');
  assert.deepEqual(tool.arguments,{recipient_email:'jay@fixture.invalid',subject:'Morning summary',body:'Approved facts only',is_html:false,user_id:'me'});
  return {status:200,body:{jsonrpc:'2.0',id:request.id,result:{content:[{type:'text',text:JSON.stringify({successful:true,data:{results:[{response:{successful:true,data:{id:'gmail-message-1',threadId:'gmail-thread-1'}}}]}})}]}}};
 };
 const transport=createComposioGmailTransport('api-key-fixture',{accountId:'account-fixture',recipient:'jay@fixture.invalid',isCurrent:async()=>true},wire);
 assert.deepEqual(await transport.authorize({recipient:'jay@fixture.invalid',subject:'Morning summary',body:'Approved facts only'}),{allowed:true});
 assert.deepEqual(await transport.authorize({recipient:'other@fixture.invalid',subject:'Morning summary',body:'Approved facts only'}),{allowed:false,reason:'COMPOSIO_RECIPIENT_CHANGED'});
 const receipt=await transport.send({recipient:'jay@fixture.invalid',subject:'Morning summary',body:'Approved facts only'},randomUUID());
 assert.equal(receipt.kind,'sent');
 if(receipt.kind==='sent')assert.equal(receipt.messageId,'gmail-message-1');
 assert.equal(requestCount,3);
 console.log(JSON.stringify({scenario:'summary-composio-transport',result:'PASS',requestCount}));
}
