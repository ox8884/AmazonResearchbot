import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PgBoss} from 'pg-boss';
import {openAcceptance} from './support/acceptance.mjs';
import {importCsv} from './support/import-csv.mjs';
import {advanceCandidate} from '../apps/worker/src/advance-candidate.ts';
import {denyTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';
const test=await openAcceptance({databaseKey:'csv20-'+Date.now()});let boss;
try{
 const filename='opportunity-finder-20.csv';
 const bytes=await readFile(new URL('../tests/fixtures/'+filename,import.meta.url));
 const imported=await importCsv(test,filename,bytes);assert.equal(imported.status,200);assert.equal(imported.body.created,20);
 const list=(await test.call('/api/candidates')).body.candidates;assert.equal(list.length,20);
 assert.equal(new Set(list.map(c=>c.keyword)).size,20);
 for(const candidate of list){assert.ok(candidate.stage);assert.equal(typeof candidate.evidenceSummary,'string');assert.ok(Array.isArray(candidate.unknowns));assert.ok(candidate.nextAction&&typeof candidate.nextAction.label==='string');assert.ok(['automatic','approval','waiting'].includes(candidate.nextAction.kind));}
 const source=(await test.pool.query('SELECT filename,sha256,blob_ciphertext,source_type FROM imports WHERE id=$1',[imported.body.importId])).rows[0];
 assert.equal(source.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(decryptSecret(source.blob_ciphertext,Buffer.from(test.encryptionKeyHex,'hex'),`import:${filename}:bytes`),bytes);
 assert.equal(source.source_type,'synthetic.kitchen.v1');
 const rows=(await test.pool.query('SELECT row_number FROM import_rows WHERE import_id=$1 ORDER BY row_number',[imported.body.importId])).rows;
 assert.deepEqual(rows.map(r=>r.row_number),Array.from({length:20},(_,i)=>i+1));
 const blocked=list[0];assert.ok(blocked);
 await test.pool.query("UPDATE candidates SET blocked_reason='web_session' WHERE id=$1",[blocked.id]);
 boss=new PgBoss({connectionString:test.databaseUrl,migrate:false,supervise:false,schedule:false});await boss.start();
 await boss.work('candidate.advance',{localConcurrency:4,batchSize:1},async jobs=>{for(const job of jobs)await advanceCandidate(test.pool,denyTransport(),job.data);});
 const deadline=Date.now()+30000;let advanced=0;
 while(Date.now()<deadline){advanced=(await test.pool.query("SELECT count(*)::int AS n FROM candidates WHERE stage='api_validation'")).rows[0].n;if(advanced===19)break;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(advanced,19,'A web-waiting candidate must not stop the other19 queued candidates');
 const after=(await test.call('/api/candidates')).body.candidates;
 assert.equal(after.find(c=>c.id===blocked.id).nextAction.target,'web_session');assert.ok(after.filter(c=>c.id!==blocked.id).every(c=>c.stage==='api_validation'));
 const repeated=await importCsv(test,filename,bytes);assert.equal(repeated.status,200);assert.equal(repeated.body.reused,true);assert.equal((await test.call('/api/candidates')).body.candidates.length,20);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM api_attempts')).rows[0].n,0);
 console.log(JSON.stringify({scenario:'csv20',result:'PASS',database:test.database,candidates:20,viewContract:true,originalBytes:true,rowNumbers:true,sourceHash:true,reuploadCandidates:20,queuedCandidatesAdvanced:19,independentWebWait:true,wireAttempts:0,scope:'isolated API/database/queue'}));
}finally{if(boss)await boss.stop({graceful:true,timeout:5000});await test.close();}
