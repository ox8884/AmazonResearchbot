import {createHash,randomUUID} from "node:crypto";
import {SYNTHETIC_SCHEMA} from "../packages/integrations/src/jungle-scout/csv.ts";
import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
const test=await openAcceptance({databaseKey:'saved-search-'+Date.now()});
try {
 const input={name:'Local reusable search',category:'Kitchen & Dining',filters:{priceMinUsd:'17.00',priceMaxUsd:'80.00',monthlySearchMin:1000,competition:'상위 리뷰 분포 확인',seasonality:'연중 수요 확인'}};
 const count=async()=>Number((await test.pool.query('SELECT count(*)::text AS count FROM saved_searches')).rows[0].count);
 const before=await count();
 for(const invalid of [{...input,name:'  '},{...input,category:'Electronics'},{...input,filters:[]},{...input,filters:{priceMinUsd:'81',priceMaxUsd:'80'}},{...input,filters:{monthlySearchMin:-1}},{...input,filters:{invented:'hidden condition'}}]){
  assert.equal((await test.call('/api/saved-searches',invalid)).status,400,'Invalid search conditions must not be stored');
 }
 assert.equal(await count(),before);
 const created=await test.call('/api/saved-searches',input);assert.equal(created.status,201);assert.ok(created.body.id);
 const persisted=(await test.call('/api/saved-searches')).body.searches.find(s=>s.id===created.body.id);
 assert.equal(persisted.marketplace,'us');assert.equal(persisted.category,input.category);assert.deepEqual(persisted.filters,input.filters);
 const blank=await test.call('/api/saved-searches',{name:'Unbounded manual search',filters:{}});assert.equal(blank.status,201);
 const blankSaved=(await test.call('/api/saved-searches')).body.searches.find(s=>s.id===blank.body.id);assert.deepEqual(blankSaved.filters,{},'Unspecified filters remain absent rather than zero');
 assert.equal((await test.call('/api/saved-searches/invalid/run',{})).status,400);
 assert.equal((await test.call('/api/saved-searches/10000000-0000-4000-8000-000000000001/run',{})).status,404);
 assert.equal((await test.call('/api/saved-searches',input,{origin:'https://wrong.invalid'})).status,403);
 const candidatesBefore=(await test.pool.query('SELECT count(*)::int AS count FROM candidates')).rows[0].count;
 const run=await test.call(`/api/saved-searches/${created.body.id}/run`,{});assert.equal(run.status,202);assert.equal(run.body.nextAction.kind,'waiting');assert.equal(run.body.nextAction.target,'manual_filters','Legacy notes require manual interpretation');
 assert.equal((await test.pool.query('SELECT count(*)::int AS count FROM candidates')).rows[0].count,candidatesBefore,'Unavailable browser must not fabricate imported candidates');
 const pendingHistory=(await test.call('/api/saved-search-runs')).body.runs.find(item=>item.id===run.body.run.id);assert.equal(pendingHistory.linkedCandidates,null);assert.equal(pendingHistory.filterVerification,'unverified');
 const repeated=await Promise.all([test.call(`/api/saved-searches/${created.body.id}/run`,{}),test.call(`/api/saved-searches/${created.body.id}/run`,{})]);assert.ok(repeated.every(item=>item.body.run.id===run.body.run.id));
 const csv=['keyword,top_price',`manual alpha ${test.runId},30`,`manual beta ${test.runId},`,''].join(String.fromCharCode(10));
 async function upload(text,runId){const boundary='search-'+test.runId;const body=Buffer.from([`--${boundary}`,'Content-Disposition: form-data; name="file"; filename="manual-original.csv"','Content-Type: text/csv','',text,`--${boundary}--`,''].join(String.fromCharCode(13,10)));return test.call(`/api/imports?searchRunId=${runId}`,body,{'content-type':`multipart/form-data; boundary=${boundary}`});}
 const imported=await upload(csv,run.body.run.id);assert.equal(imported.status,200);assert.equal(imported.body.created,2);
 const history=(await test.call('/api/saved-search-runs')).body.runs.find(item=>item.id===run.body.run.id);assert.equal(history.state,'imported');assert.equal(history.linkedCandidates,2);assert.equal(history.filename,'manual-original.csv');assert.equal(history.sha256,createHash('sha256').update(csv).digest('hex'));assert.deepEqual(history.snapshot.filters,input.filters);assert.equal(history.filterVerification,'unverified');
 assert.equal((await test.pool.query('SELECT source_type FROM imports WHERE id=$1',[history.importId])).rows[0].source_type,SYNTHETIC_SCHEMA,'Linking a saved search must not relabel the CSV as verified Opportunity Finder data');
 assert.equal((await upload(csv,run.body.run.id)).body.reused,true);
 const importCounts=async()=>(await test.pool.query('SELECT (SELECT count(*)::int FROM imports) AS imports,(SELECT count(*)::int FROM import_rows) AS rows,(SELECT count(*)::int FROM sources) AS sources,(SELECT count(*)::int FROM evidence) AS evidence,(SELECT count(*)::int FROM candidate_import_rows) AS links,(SELECT count(*)::int FROM pgboss.job) AS jobs')).rows[0];
 const beforeRollback=await importCounts();
 const linkedRunState=async()=>(await test.pool.query('SELECT state,import_id,completed_at FROM saved_search_runs WHERE id=$1',[run.body.run.id])).rows[0];
 const beforeRunConflict=await linkedRunState();
 const beforeConflict=(await test.pool.query('SELECT count(*)::int AS n FROM candidates')).rows[0].n;
 const conflict=await upload('keyword'+String.fromCharCode(10)+'must not import '+test.runId,run.body.run.id);assert.equal(conflict.status,409);assert.equal(conflict.body.code,'SEARCH_RUN_ALREADY_IMPORTED');assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM candidates')).rows[0].n,beforeConflict);
 assert.deepEqual(await linkedRunState(),beforeRunConflict,'Conflicting CSV must preserve the existing linked run and completion time');
 assert.deepEqual(await importCounts(),beforeRollback,'Conflicting CSV must roll back imports, rows, sources, evidence, links and queued jobs');
 await assert.rejects(test.pool.query("UPDATE saved_search_runs SET snapshot='{}' WHERE id=$1",[run.body.run.id]),/immutable/);
 const enqueueRun=await test.call(`/api/saved-searches/${blank.body.id}/run`,{});
 const beforeEnqueueFailure=await importCounts();
 const beforeCandidateFailure=(await test.pool.query('SELECT count(*)::int AS n FROM candidates')).rows[0].n;
 const enqueueCsv=["keyword","enqueue first "+test.runId,"enqueue second "+test.runId].join(String.fromCharCode(10));
 const send=test.boss.send;let sendCalls=0;test.boss.send=async(...args)=>++sendCalls===2?null:send.apply(test.boss,args);
 let rejectedEnqueue;
 try{rejectedEnqueue=await upload(enqueueCsv,enqueueRun.body.run.id);}
 finally{test.boss.send=send;}
 assert.equal(sendCalls,2,'Failure must occur after a real first queue insertion');
 assert.equal(rejectedEnqueue.status,500,'An unqueued candidate must not be reported as successfully imported');
 assert.deepEqual(await importCounts(),beforeEnqueueFailure);
 assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM candidates')).rows[0].n,beforeCandidateFailure);
 const untouched=(await test.pool.query('SELECT state,import_id FROM saved_search_runs WHERE id=$1',[enqueueRun.body.run.id])).rows[0];
 assert.equal(untouched.state,'awaiting_csv');assert.equal(untouched.import_id,null);
 const retried=await upload(enqueueCsv,enqueueRun.body.run.id);assert.equal(retried.status,200);assert.equal(retried.body.created,2);
 const secondRun=await test.call(`/api/saved-searches/${created.body.id}/run`,{});assert.notEqual(secondRun.body.run.id,run.body.run.id);assert.equal((await upload(csv,secondRun.body.run.id)).body.reused,true);
 const otherUser=randomUUID();await test.pool.query('INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,false,now(),now())',[otherUser,'Other synthetic user',otherUser+'@fixture.invalid']);
 const otherRun=(await test.pool.query("INSERT INTO saved_search_runs(saved_search_id,created_by,search_revision,snapshot) VALUES($1,$2,1,'{}') RETURNING id",[created.body.id,otherUser])).rows[0].id;
 assert.equal((await upload(csv,otherRun)).status,404);assert.ok((await test.call('/api/saved-search-runs')).body.runs.every(item=>item.id!==otherRun));
 console.log(JSON.stringify({scenario:'saved-searches',result:'PASS',database:test.database,filtersPersisted:true,unknownFiltersAbsent:true,invalidWritesBlocked:true,unavailableBrowserWait:true,durableRuns:true,atomicCsvLink:true,crossOwnerBlocked:true,originalSourcePreserved:true,duplicateUploadReused:true,allImportTablesRolledBack:true,missingJobRollsBackAndRetries:true,transportScope:'API-only; transports disabled; worker not run'}));
} finally {await test.close();}
