import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {advanceCandidate} from '../apps/worker/src/advance-candidate.ts';
import {denyTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
const test=await openAcceptance();
try {
 const keyword='QA reimport '+test.runId,terminalKeyword='QA final '+test.runId;
 const csv=count=>`keyword,review_700_count,review_2000_count,top_price,monthly_revenue_competitors\n${keyword},2,${count},30,5\n${terminalKeyword},2,${count},30,5\n`;
 const upload=async text=>{const boundary='forge-'+test.runId;const body=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-reimport.csv"\r\nContent-Type: text/csv\r\n\r\n${text}\r\n--${boundary}--\r\n`);return test.call('/api/imports',body,{'content-type':`multipart/form-data; boundary=${boundary}`});};
 const invalidInputs=[
   `product,price
QA wrong table ${test.runId},30
`,
   `keyword,marketplace
QA wrong market ${test.runId},ca
`,
   `keyword,Keyword
QA first ${test.runId},QA hidden ${test.runId}
`,
 ];
 for(const invalid of invalidInputs){
   const before=(await test.pool.query('SELECT count(*)::int n FROM candidates')).rows[0].n;
   const response=await upload(invalid);
   assert.equal(response.status,422,'Unrecognized columns, a non-US market, or ambiguous duplicate columns must be rejected');
   assert.equal((await test.pool.query('SELECT count(*)::int n FROM candidates')).rows[0].n,before,'Invalid import must not create or change candidates');
 }
 const caseKeyword='QA normalized header '+test.runId;
 assert.equal((await upload(` Keyword , MarketPlace
${caseKeyword}, US
`)).status,200,'Trimmed case-insensitive keyword and US headers remain supported');
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM candidates WHERE keyword_display=$1',[caseKeyword])).rows[0].n,1);
 assert.equal((await upload(csv(0))).status,200);
 const candidates=(await test.pool.query('SELECT id,keyword_display FROM candidates WHERE keyword_display=ANY($1)',[[keyword,terminalKeyword]])).rows;
 const working=candidates.find(c=>c.keyword_display===keyword).id,terminal=candidates.find(c=>c.keyword_display===terminalKeyword).id;
 await advanceCandidate(test.pool,denyTransport(),{candidateId:working,stage:'imported',inputVersion:1});
 await test.pool.query("UPDATE candidates SET stage='decision_recorded' WHERE id=$1",[terminal]);
 const terminalRepresentativeCsv=`keyword,representative_asin\n${terminalKeyword},B0F7M3LVN8\n`;
 assert.equal((await upload(terminalRepresentativeCsv)).status,200);
 assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[terminal])).rows[0].stage,'decision_recorded','Representative ASIN reimport must preserve a terminal candidate');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM candidate_events WHERE candidate_id=$1 AND stage='api_validation'",[terminal])).rows[0].n,0,'Terminal candidate must not receive representative validation events');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1 AND data->>'inputVersion'='2'",[terminal])).rows[0].n,0,'Terminal candidate must not be queued after reimport');
 const version=(await test.pool.query('SELECT max(version)::int v FROM settings_versions')).rows[0].v;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass','{\"synthetic\":true}')",[working,version]);
 const imported=await Promise.all([upload(csv(2)),upload(csv(2))]);
 assert.ok(imported.every(r=>r.status===200),'Concurrent same-file import must be idempotent');
 assert.equal(imported.filter(r=>r.body.reused).length,1);
 const updated=(await test.pool.query('SELECT id,stage,input_version FROM candidates WHERE id=ANY($1)',[[working,terminal]])).rows;
 assert.deepEqual(updated.find(c=>c.id===working),{id:working,stage:'imported',input_version:2});
 assert.equal(updated.find(c=>c.id===terminal).stage,'decision_recorded');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM evaluations WHERE candidate_id=$1 AND stale=false",[working])).rows[0].n,0);
 await advanceCandidate(test.pool,denyTransport(),{candidateId:working,stage:'imported',inputVersion:2});
 assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[working])).rows[0].stage,'rejected','Newest review evidence must be used');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1 AND data->>'inputVersion'='2'",[terminal])).rows[0].n,0);
 assert.equal((await upload(csv(2))).body.reused,true);

 const fractionalKeyword='QA fractional '+test.runId;
 const invalidCsv=`keyword,review_700_count,review_2000_count,top_price
${fractionalKeyword},3,2.5,${'9'.repeat(400)}
`;
 assert.equal((await upload(invalidCsv)).status,200);
 const fractional=(await test.pool.query('SELECT id FROM candidates WHERE keyword_display=$1',[fractionalKeyword])).rows[0];
 const invalidEvidence=(await test.pool.query("SELECT field,kind FROM evidence WHERE candidate_id=$1 AND field IN ('review_2000_count','top_price')",[fractional.id])).rows;
 assert.ok(invalidEvidence.every(row=>row.kind==='unknown'),'Fractional counts and numeric overflow must stay unknown');
 await advanceCandidate(test.pool,denyTransport(),{candidateId:fractional.id,stage:'imported',inputVersion:1});
 assert.notEqual((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[fractional.id])).rows[0].stage,'rejected');
 console.log(JSON.stringify({scenario:'reimport',result:'PASS',freshNonterminal:'processed with newest evidence',terminal:'preserved',concurrentSameFile:'one import',oldEvaluations:'stale',invalidNumbers:'unknown not rejected',paidCalls:0}));
}finally{await test.close();}
