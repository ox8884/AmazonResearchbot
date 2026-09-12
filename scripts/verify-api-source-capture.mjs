import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {openAcceptance} from './support/acceptance.mjs';
import {persistOfficialSource} from '../apps/worker/src/api-source-store.ts';
const test=await openAcceptance({databaseKey:'api-source-'+Date.now()});
try{
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",['source-'+test.runId])).rows[0];
 const version=(await test.pool.query('SELECT max(version)::int AS version FROM settings_versions')).rows[0].version;
 const context={candidateId:candidate.id,inputVersion:1,settingsVersion:version};
 const fingerprint=randomBytes(32).toString('hex'),body={data:[],note:'  raw value stays unchanged  '};
 await test.pool.query("INSERT INTO api_cache(fingerprint,generation,body,ttl_hours,stored_at) VALUES($1,1,$2::jsonb,24,'2026-09-01T00:00:00Z')",[fingerprint,JSON.stringify(body)]);
 const input={pool:test.pool,context,fingerprint,body,endpoint:'product_database_query'};
 const first=await persistOfficialSource(input),again=await persistOfficialSource(input);
 assert.equal(again.sourceId,first.sourceId);
 await test.pool.query("UPDATE api_cache SET stored_at='2026-09-02T00:00:00Z' WHERE fingerprint=$1",[fingerprint]);
 const refreshed=await persistOfficialSource(input);
 assert.notEqual(refreshed.sourceId,first.sourceId,'A new observation cannot point to an old immutable capture');
 const captures=(await test.pool.query('SELECT observed_at,raw_body FROM api_validation_sources WHERE candidate_id=$1 ORDER BY observed_at',[candidate.id])).rows;
 assert.equal(captures.length,2);assert.equal(captures[0].observed_at.toISOString(),'2026-09-01T00:00:00.000Z');assert.deepEqual(captures[0].raw_body,body);
 await test.pool.query("UPDATE api_cache SET body='{}'::jsonb WHERE fingerprint=$1",[fingerprint]);
 assert.equal((await persistOfficialSource(input)).observedAt,null,'A different cached body cannot lend its timestamp to this response');
 for(const endpoint of ['keywords_by_keyword_query','historical_search_volume','sales_estimates_query','share_of_voice']){
  const result=await persistOfficialSource({...input,endpoint,fingerprint:randomBytes(32).toString('hex')});
  assert.equal(result.observedAt,null,'Missing cache time remains unknown');
 }
 const missing={...input,endpoint:'share_of_voice',fingerprint:randomBytes(32).toString('hex')};
 assert.equal((await persistOfficialSource(missing)).sourceId,(await persistOfficialSource(missing)).sourceId,'Null observation times also deduplicate');
 await assert.rejects(test.pool.query("UPDATE api_validation_sources SET raw_body='{}' WHERE candidate_id=$1",[candidate.id]));
 console.log(JSON.stringify({scenario:'api-source-capture',result:'PASS',allEndpoints:true,newObservationPreserved:true,sameObservationDeduplicated:true,nullTimePreserved:true,rawImmutable:true,paidCalls:0}));
}finally{await test.close();}
