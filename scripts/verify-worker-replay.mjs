import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {advanceCandidate} from '../apps/worker/src/advance-candidate.ts';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {denyTransport,createSimulatorTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
const test=await openAcceptance({databaseKey:`worker-replay-${process.pid}-${Date.now().toString(36)}`});
let server;
try {
 const inserted=await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage,input_version) VALUES('us',$1,$1,'decision_recorded',2) RETURNING id",['QA stale job '+test.runId]);
 const id=inserted.rows[0].id;
 await advanceCandidate(test.pool,denyTransport(),{candidateId:id,stage:'imported',inputVersion:1});
 assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[id])).rows[0].stage,'decision_recorded');
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM candidate_events WHERE candidate_id=$1',[id])).rows[0].n,0);

 const day=new Date().toISOString().slice(0,10);
 const budget=await test.pool.query("INSERT INTO budget_days(day_utc,wire_limit) VALUES($1,1) ON CONFLICT(day_utc) DO UPDATE SET wire_limit=budget_days.reserved+budget_days.consumed+1 RETURNING wire_limit",[day]);
 const current=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'acceptance-fixture',$2::jsonb)",[current.version+1,JSON.stringify({...current.snapshot,jsDailyWireCap:budget.rows[0].wire_limit})]);
 const keyword='Synthetic silicone spoon '+test.runId;
 const subject=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[keyword])).rows[0];
 let captured;let responseStatus=200;let retryAfter=null;let onWire=async()=>{};
 server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);captured={url:new URL(req.url,'http://fixture.invalid'),body:JSON.parse(Buffer.concat(chunks).toString())};await onWire();res.statusCode=responseStatus;if(retryAfter!==null)res.setHeader('retry-after',retryAfter);res.setHeader('content-type','application/json');res.end('{"data":[]}');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 await advanceCandidate(test.pool,createSimulatorTransport(`http://127.0.0.1:${server.address().port}`,'development'),{candidateId:subject.id,stage:'api_validation',inputVersion:1});
 assert.deepEqual(captured.body.data.attributes.include_keywords,[keyword]);
 assert.deepEqual(captured.body.data.attributes.categories,['Kitchen & Dining']);
 assert.equal(captured.url.searchParams.get('marketplace'),'us');
 assert.equal(captured.url.searchParams.get('page[size]'),'100');
 assert.equal((await test.pool.query("SELECT outcome FROM evaluations WHERE candidate_id=$1 AND kind='api_validation' ORDER BY created_at DESC LIMIT 1",[subject.id])).rows[0]?.outcome,'hold','Actual worker must consume and classify the response');
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM api_validation_sources WHERE candidate_id=$1',[subject.id])).rows[0].n,1);

 const nextBudget=(await test.pool.query('UPDATE budget_days SET wire_limit=reserved+consumed+1 WHERE day_utc=$1 RETURNING wire_limit',[day])).rows[0];
 const latest=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'acceptance-fixture',$2::jsonb)",[latest.version+1,JSON.stringify({...latest.snapshot,jsDailyWireCap:nextBudget.wire_limit})]);
 const callbackCandidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",['QA newer callback '+test.runId])).rows[0];
 onWire=async()=>{await test.pool.query('UPDATE candidates SET input_version=2,blocked_reason=NULL WHERE id=$1',[callbackCandidate.id]);};responseStatus=503;
  await advanceCandidate(test.pool,createSimulatorTransport(`http://127.0.0.1:${server.address().port}`,'development'),{candidateId:callbackCandidate.id,stage:'api_validation',inputVersion:1});
  assert.deepEqual((await test.pool.query('SELECT input_version,blocked_reason FROM candidates WHERE id=$1',[callbackCandidate.id])).rows[0],{input_version:2,blocked_reason:null});

  const retryBudget=(await test.pool.query('UPDATE budget_days SET wire_limit=consumed+1 WHERE day_utc=$1 RETURNING wire_limit',[day])).rows[0];
  const retrySettings=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
  await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'acceptance-fixture',$2::jsonb)",[retrySettings.version+1,JSON.stringify({...retrySettings.snapshot,jsDailyWireCap:retryBudget.wire_limit})]);
  const deferredCandidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",['QA deferred retry '+test.runId])).rows[0];
  const beforeSchedules=Number((await test.pool.query('SELECT count(*)::int count FROM api_retry_schedules')).rows[0].count);
  onWire=async()=>{};responseStatus=429;retryAfter='0';
  await advanceCandidate(test.pool,createSimulatorTransport(`http://127.0.0.1:${server.address().port}`,'development'),{candidateId:deferredCandidate.id,stage:'api_validation',inputVersion:1});
  const retrySchedule=(await test.pool.query('SELECT operation_id,retry_count,next_attempt_at FROM api_retry_schedules ORDER BY created_at DESC LIMIT 1')).rows[0];
  assert.equal(retrySchedule.retry_count,1);
  assert.equal(Number((await test.pool.query('SELECT count(*)::int count FROM api_retry_schedules')).rows[0].count),beforeSchedules+1);
  const delayedJob=(await test.pool.query("SELECT data,start_after FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1 ORDER BY created_on DESC LIMIT 1",[deferredCandidate.id])).rows[0];
  assert.deepEqual(delayedJob.data,{candidateId:deferredCandidate.id,stage:'api_validation',inputVersion:1});
  assert.ok(delayedJob.start_after>new Date(),'Deferred retry must become a future durable queue job');
  await test.pool.query("UPDATE api_retry_schedules SET next_attempt_at=now()-interval '1 second' WHERE operation_id=$1",[retrySchedule.operation_id]);
  const rerunBudget=(await test.pool.query('UPDATE budget_days SET wire_limit=consumed+1 WHERE day_utc=$1 RETURNING wire_limit',[day])).rows[0];
  const rerunSettings=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
  await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'acceptance-fixture',$2::jsonb)",[rerunSettings.version+1,JSON.stringify({...rerunSettings.snapshot,jsDailyWireCap:rerunBudget.wire_limit})]);
  responseStatus=200;retryAfter=null;
  await advanceCandidate(test.pool,createSimulatorTransport(`http://127.0.0.1:${server.address().port}`,'development'),{candidateId:deferredCandidate.id,stage:'api_validation',inputVersion:1});
  assert.equal(Number((await test.pool.query('SELECT count(*)::int count FROM api_retry_schedules WHERE operation_id=$1',[retrySchedule.operation_id])).rows[0].count),0);

  console.log(JSON.stringify({scenario:'worker-replay',result:'PASS',staleJob:'no stage reset, no new events',query:'actual keyword, Kitchen & Dining, US, page100',callbackVersionGuard:true,deferredRetry:'durable pgboss job then due dispatch',paidCalls:0}));
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await test.close();}
