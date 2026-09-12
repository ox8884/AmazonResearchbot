import {runSummaryDeliveryCycle} from "../apps/worker/src/summary-delivery-loop.ts";
import {createMailpitTransport} from "../packages/integrations/src/mail/mailpit.ts";
import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {prepareSummaryDelivery,dispatchSummaryDelivery,recoverSummaryDeliveries,reconcileSummaryDelivery} from '../apps/worker/src/summary-delivery.ts';
import {buildDailySummary} from '../packages/db/src/daily-summary.ts';
import {randomUUID} from 'node:crypto';
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
