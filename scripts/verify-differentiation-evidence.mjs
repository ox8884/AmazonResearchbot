import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openAcceptance} from './support/acceptance.mjs';
import {recordDifferentiationEvidence} from '../apps/worker/src/ai-business.ts';
import {loadCanonicalNicheEvidence} from '../apps/worker/src/api-validation-store.ts';

const test=await openAcceptance({databaseKey:'differentiation-evidence-'+Date.now()});
try{
 const settingsVersion=(await test.pool.query('SELECT max(version)::int AS v FROM settings_versions')).rows[0].v;
 const proposal=reviewRefs=>({status:'proposed',customerProblem:'Handles slip when wet',featureRefs:['p1'],reviewRefs,change:{field:'material',proposedValue:'Silicone grip'}});
 async function candidateWith(result){
  const id=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",['differentiation '+randomUUID()])).rows[0].id;
  const task=randomUUID();
  await test.pool.query("INSERT INTO ai_execution_operations(id,role,mode,state,result_payload) VALUES($1,'niche_analysis','activation-approved-only','succeeded',$2::jsonb)",[task,JSON.stringify(result)]);
  await test.pool.query("INSERT INTO ai_business_tasks(id,candidate_id,input_version,settings_version,role,input_payload,state) VALUES($1,$2,1,$3,'niche_analysis','{}'::jsonb,'succeeded')",[task,id,settingsVersion]);
  return {id,task};
 }
 const cited=await candidateWith({role:'niche_analysis',summary:'s',suggestions:[],differentiationProposal:proposal(['r1'])});
 assert.equal(await recordDifferentiationEvidence(test.pool,cited.id),true,'A proposal citing customer reviews is recorded');
 assert.equal(await recordDifferentiationEvidence(test.pool,cited.id),false,'The same task is recorded once');
 const stored=(await test.pool.query("SELECT kind,value_text,source_id FROM evidence WHERE candidate_id=$1 AND field='differentiation'",[cited.id])).rows;
 assert.deepEqual(stored,[{kind:'estimate',value_text:'true',source_id:'ai-business-task:'+cited.task}]);
 const canonical=await loadCanonicalNicheEvidence(test.pool,cited.id);
 assert.equal(canonical.differentiation.kind,'estimate');assert.equal(canonical.differentiation.value,true,'The verdict reads it as differentiation evidence');

 const claimsOnly=await candidateWith({role:'niche_analysis',summary:'s',suggestions:[],differentiationProposal:proposal([])});
 assert.equal(await recordDifferentiationEvidence(test.pool,claimsOnly.id),false,'Seller feature claims alone never pass differentiation');
 const none=await candidateWith({role:'niche_analysis',summary:'No usable review content',suggestions:[],differentiationProposal:null});
 assert.equal(await recordDifferentiationEvidence(test.pool,none.id),false,'No proposal leaves differentiation unknown');
 assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM evidence WHERE candidate_id=ANY($1::uuid[]) AND field='differentiation'",[[claimsOnly.id,none.id]])).rows[0].n,0);
 console.log(JSON.stringify({scenario:'differentiation-evidence',result:'PASS',reviewCitedRecorded:true,recordedOnce:true,claimsOnlyRejected:true,noProposalUnknown:true}));
}finally{await test.close();}
