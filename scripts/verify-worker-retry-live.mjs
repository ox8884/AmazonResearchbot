import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {PgBoss} from 'pg-boss';
import {openAcceptance} from './support/acceptance.mjs';
const test=await openAcceptance({databaseKey:'worker-retry-live-'+Date.now()});
let child,producer;
const wires=[];
const server=createServer(async(req,res)=>{
 for await(const chunk of req)void chunk;
 wires.push(Date.now());
 res.writeHead(wires.length<=2?429:200,{'content-type':'application/json'});
 res.end(JSON.stringify(wires.length<=2?{error:'Synthetic throttle'}:{data:[],links:{next:null}}));
});
server.listen(0,'127.0.0.1');await once(server,'listening');
async function until(probe,label){const deadline=Date.now()+45000;while(Date.now()<deadline){const value=await probe();if(value)return value;await delay(100);}throw new Error('Timed out: '+label);}
function start(){
 const address=server.address();assert.ok(address&&typeof address!=='string');
 return spawn(process.execPath,['--import','tsx','apps/worker/src/index.ts'],{cwd:process.cwd(),env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,APP_ENV:'development',DATABASE_URL:test.databaseUrl,ENCRYPTION_KEY:'87'.repeat(32),MAIL_TRANSPORT:'disabled',JS_SIMULATOR_ORIGIN:`http://127.0.0.1:${address.port}`},stdio:'ignore'});
}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'close');child.kill('SIGKILL');await done;}child=undefined;}
try{
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'worker-retry-fixture',jsonb_set(snapshot,'{jsDailyWireCap}','3'::jsonb) FROM settings_versions ORDER BY version DESC LIMIT 1");
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",['QA live retry '+test.runId])).rows[0];
 producer=new PgBoss({connectionString:test.databaseUrl,migrate:false,schedule:false,supervise:false});await producer.start();
 await producer.send('candidate.advance',{candidateId:candidate.id,stage:'api_validation',inputVersion:1});
 child=start();
 const scheduled=await until(async()=>{
  const result=await test.pool.query("SELECT start_after FROM pgboss.job WHERE name='candidate.advance' AND singleton_key=$1 AND state='created'",[`jungle-scout-retry:${candidate.id}:1`]);
  return result.rows[0];
 },'persisted delayed retry job');
 assert.equal(wires.length,1);assert.ok(scheduled.start_after>new Date());
 await stop();
 child=start();
 await until(async()=>Number((await test.pool.query("SELECT count(*)::int AS n FROM api_attempts WHERE status='succeeded'")).rows[0].n)===1,'fresh worker consuming delayed retry');
 assert.equal(wires.length,3);assert.ok(wires[1]-wires[0]>=4900,'Actual queue retry must respect the five-second fallback');
 assert.ok(wires[2]-wires[1]>=29900,'The active singleton retry must reschedule for thirty seconds');
 const budget=(await test.pool.query('SELECT sum(consumed)::int AS consumed,sum(reserved)::int AS reserved FROM budget_days')).rows[0];
 assert.deepEqual(budget,{consumed:3,reserved:0});
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM api_retry_schedules')).rows[0].n,0);
 assert.equal((await test.call('/api/candidates/'+candidate.id)).status,200);
 console.log(JSON.stringify({scenario:'worker-retry-live',result:'PASS',database:test.database,workerProcesses:2,wires:3,elapsedBetweenWiresMs:[wires[1]-wires[0],wires[2]-wires[1]],actualDelayedJobConsumed:true,budget,externalCalls:0}));
}finally{await stop();if(producer)await producer.stop({graceful:false,timeout:2000});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await test.close();}
