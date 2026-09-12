import pg from "pg";
import {randomBytes} from "node:crypto";
import {assertDevelopmentDatabase} from "./support/development-database.mjs";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {openAcceptance} from "./support/acceptance.mjs";
import {readRuntimeAuthority} from "../packages/security/src/runtime-authority.ts";
import assert from 'node:assert/strict';
import {validateHostAuthority,validateDatabaseLocation,assertDatabaseAuthority} from '../packages/security/src/runtime-authority.ts';
const manifest={version:1,machineId:'a'.repeat(32),workerIdentity:'oracle:ocid1.instance.oc1.fixture.example'};
const host={platform:'linux',uid:1001,username:'forge-ops-worker',invocationId:'b'.repeat(32),cgroup:'0::/system.slice/forge-ops-worker.service',machineId:manifest.machineId,authorityDirectory:{uid:0,mode:0o755,directory:true},authorityFile:{uid:0,mode:0o640,regular:true,size:200},manifest};
assert.equal(validateHostAuthority('worker',host),manifest.workerIdentity);
for(const change of [{platform:'win32'},{uid:0},{username:'root'},{invocationId:''},{cgroup:'0::/user.slice/session.scope'},{cgroup:'0::/user.slice/user@1001.service/forge-ops-worker.service'},{machineId:'c'.repeat(32)},{authorityFile:{...host.authorityFile,uid:1001}},{authorityFile:{...host.authorityFile,mode:0o666}},{authorityDirectory:{...host.authorityDirectory,mode:0o777}}])assert.throws(()=>validateHostAuthority('worker',{...host,...change}));
const uri='postgresql:///forge_ops?host=/var/run/postgresql&user=forge_ops_worker';
assert.equal(validateDatabaseLocation('production','worker',uri),uri);
for(const bad of ['postgres://forge_ops_worker@localhost/forge_ops','postgres://worker:PRIVATE_PASSWORD@remote.invalid/forge_ops',uri+'&host=remote.invalid',uri.replace('forge_ops_worker','forge_ops_api'),uri+'&options=unsafe'])assert.throws(()=>validateDatabaseLocation('production','worker',bad));
assert.throws(()=>validateDatabaseLocation('development','worker','postgres://remote.invalid/forge_ops'));
const good={environment:'production',worker_identity:manifest.workerIdentity,db_role:'forge_ops_worker',session_role:'forge_ops_worker',auth_identity:'peer:forge-ops-worker',local_socket:true,privileged:false,member_of_role:false,ddl_allowed:false,can_claim:true,can_read_jobs:true};
const context={appEnv:'production',service:'worker',databaseUrl:uri,workerIdentity:manifest.workerIdentity};
await assertDatabaseAuthority({query:async()=>({rows:[good]})},context);
for(const change of [{worker_identity:'other'},{environment:'development'},{db_role:'forge_ops_api'},{session_role:'postgres'},{auth_identity:null},{auth_identity:'trust:forge-ops-worker'},{local_socket:false},{privileged:true},{member_of_role:true},{ddl_allowed:true},{can_claim:false}])await assert.rejects(assertDatabaseAuthority({query:async()=>({rows:[{...good,...change}]})},context));
await assert.rejects(assertDatabaseAuthority({query:async()=>({rows:[good,good]})},context));
console.log(JSON.stringify({scenario:'production-authority',result:'PASS',hostPolicy:true,unixSocketOnly:true,peerRoleRequired:true,mixedIdentityDenied:true,actualOracleVerified:false}));

const apiContext={...context,service:'api'};
const apiRow={...good,db_role:'forge_ops_api',session_role:'forge_ops_api',auth_identity:'peer:forge-ops-api',can_claim:false,can_read_jobs:false};
await assertDatabaseAuthority({query:async()=>({rows:[apiRow]})},apiContext);
await assert.rejects(assertDatabaseAuthority({query:async()=>({rows:[{...apiRow,can_claim:true}]})},apiContext));
await assert.rejects(assertDatabaseAuthority({query:async()=>({rows:[{...apiRow,can_read_jobs:true}]})},apiContext));

const isolated=await openAcceptance({databaseKey:'production-guard-'+Date.now()});
try{
 const dev=await readRuntimeAuthority('worker',{APP_ENV:'development',DATABASE_URL:isolated.databaseUrl});await assertDatabaseAuthority(isolated.pool,dev);await assertDevelopmentDatabase(isolated.pool);
 const connection=await isolated.pool.connect();try{await connection.query('BEGIN');await connection.query("INSERT INTO deployment_identity(environment,worker_identity) VALUES('production','synthetic')");await assert.rejects(assertDatabaseAuthority(connection,dev));await assert.rejects(assertDevelopmentDatabase(connection));}finally{await connection.query('ROLLBACK');connection.release();}
 const journalName='forge_ops_acceptance_'+randomBytes(6).toString('hex');
 await isolated.pool.query(`CREATE DATABASE "${journalName}"`);
 const journalUrl=new URL(isolated.databaseUrl);journalUrl.pathname='/'+journalName;
 const journal=new pg.Pool({connectionString:journalUrl.toString()});
 try{
  await assertDevelopmentDatabase(journal);
  await journal.query('CREATE TABLE schema_migrations(id text PRIMARY KEY)');await assertDevelopmentDatabase(journal);
  await journal.query("INSERT INTO schema_migrations(id) VALUES('synthetic-unidentified-journal')");await assert.rejects(assertDevelopmentDatabase(journal));
  assert.equal((await journal.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,1);
 }finally{await journal.end();}
}finally{await isolated.close();}
let dials=0;const server=createServer(socket=>{dials++;socket.destroy();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const target=`postgres://synthetic:PRIVATE_AUTHORITY_SENTINEL@127.0.0.1:${server.address().port}/forge_ops`;
 let blockedEntries=0;
 for(const [file,mode,args] of [['apps/worker/src/index.ts','production',[]],['apps/api/src/index.ts','production',[]],['apps/worker/src/scheduler.ts','production',[]],['apps/worker/src/index.ts','development',['--production']],['scripts/dev.mjs','production',[]],['scripts/dev.mjs','development',[]],['scripts/migrate.ts','production',[]],['scripts/migrate.ts','development',[]]]){
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',file,...args],{env:{...process.env,APP_ENV:mode,DATABASE_URL:target,AI_TRANSPORT:'disabled',JS_TRANSPORT:'disabled',MAIL_TRANSPORT:'disabled'},stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});child.on('error',reject);child.on('close',code=>resolve({code,output}));});
  assert.notEqual(result.code,0);assert.match(result.output,file.startsWith('scripts/')?/LOCAL_DEVELOPMENT_/:/RUNTIME_AUTHORITY_REQUIRED/);blockedEntries++;assert.ok(!result.output.includes('PRIVATE_AUTHORITY_SENTINEL'));
 }
 assert.equal(dials,0);
 console.log(JSON.stringify({scenario:'production-startup-process',result:'PASS',platform:process.platform,blockedEntries,databaseDials:dials,developmentDatabaseAccepted:true,actualOracleVerified:false}));
}finally{await new Promise(resolve=>server.close(resolve));}
