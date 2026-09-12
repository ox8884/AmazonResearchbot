import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {openAcceptance} from './support/acceptance.mjs';
const key='92'.repeat(32),test=await openAcceptance({databaseKey:'planner-live-'+Date.now(),encryptionKeyHex:key});
let child,output='';
async function until(probe,label){const end=Date.now()+25000;while(Date.now()<end){if(await probe())return;await delay(100);}throw new Error('Timed out: '+label);}
function start(){output='';const processChild=spawn(process.execPath,['--import','tsx','apps/worker/src/index.ts'],{cwd:process.cwd(),env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,APP_ENV:'development',DATABASE_URL:test.databaseUrl,ENCRYPTION_KEY:key,MAIL_TRANSPORT:'disabled'},stdio:['ignore','pipe','pipe']});processChild.stdout.on('data',chunk=>{output+=chunk.toString();});processChild.stderr.on('data',chunk=>{output+=chunk.toString();});return processChild;}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'close');child.kill('SIGKILL');await exited;}child=undefined;}
try{
 const csv='keyword\n'+Array.from({length:20},(_,i)=>`planner-live-${test.runId}-${i}`).join('\n');const boundary='planner-'+test.runId;
 const body=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-planner.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`);
 const imported=await test.call('/api/imports',body,{'content-type':`multipart/form-data; boundary=${boundary}`});assert.equal(imported.status,200);assert.equal(imported.body.created,20);
 await test.pool.query("UPDATE pgboss.job SET state='failed',completed_on=now() WHERE name='candidate.advance' AND state='created'");
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'live-planner-fixture',snapshot || $1::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1",[JSON.stringify({timezone:'America/Chicago',researchStartLocalTime:'00:00',summaryLocalTime:'00:00',jsDailyWireCap:0})]);
 child=start();await until(()=>output.includes('worker listening for candidate.advance'),'worker readiness');
 await until(async()=>Number((await test.pool.query("SELECT count(*)::int AS n FROM candidates WHERE stage='api_validation' AND blocked_reason='budget'")).rows[0].n)===20,'automatic stage advancement');
 await until(async()=>Number((await test.pool.query("SELECT count(*)::int AS n FROM pgboss.job WHERE name='candidate.advance' AND state='completed'")).rows[0].n)===20,'daily jobs complete');
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM daily_planner_items')).rows[0].n,20);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM daily_summaries')).rows[0].n,1);
 const summary=(await test.call('/api/summaries')).body.summaries[0];const saved=(await test.call('/api/summaries/'+summary.id)).body;
 assert.equal(saved.payload.candidates.length,20);assert.ok(saved.payload.candidates.every(c=>c.unknowns.length>0));assert.equal(saved.payload.delivery,'not_sent');
 await stop();child=start();await until(()=>output.includes('worker listening for candidate.advance'),'restarted worker');await delay(1000);
 assert.equal(child.exitCode,null);assert.ok(!output.includes('Daily planning interrupted'));
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM daily_runs')).rows[0].n,2);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM daily_planner_items')).rows[0].n,20);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM daily_summaries')).rows[0].n,1);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM api_attempts')).rows[0].n,0);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM external_actions')).rows[0].n,0);
 console.log(JSON.stringify({scenario:'planner-live',result:'PASS',database:test.database,csvCandidates:20,recoveredJobs:20,advancedToBudgetWait:20,workerProcesses:2,summaries:1,noDuplicateDailyRun:true,externalCalls:0}));
}finally{await stop();await test.close();}
