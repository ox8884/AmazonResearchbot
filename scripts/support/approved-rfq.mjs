import assert from 'node:assert/strict';
export async function approvedRfq(test,label){
  const settings=(await test.call('/api/settings')).body;
  const rows=await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",['QA '+label+' '+test.runId]);const candidateId=rows.rows[0].id;
  await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass','{\"synthetic\":true,\"inputVersion\":1}'::jsonb)",[candidateId,settings.version]);
  const spec=(await test.call(`/api/candidates/${candidateId}/specs`,{material:'synthetic',dimensions:'30 cm',packaging:'test',requirements:'local acceptance',requestedQuantity:300,source:'synthetic fixture'})).body;
  const supplier=(await test.call(`/api/candidates/${candidateId}/suppliers`,{name:'Synthetic '+label,email:'recovery@fixture.invalid',source:'synthetic only',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'synthetic matched'})).body;
  const draft=(await test.call(`/api/candidates/${candidateId}/rfqs`,{specId:spec.id,supplierId:supplier.id,quantity:300,subject:'QA '+label+' '+test.runId,body:'Synthetic local acceptance '+test.runId})).body;
  const request=await test.call(`/api/rfqs/${draft.id}/approval`,{});assert.equal(request.status,201);assert.equal((await test.call(`/api/approvals/${request.body.approvalId}/approve`,{})).status,200);
  const action=(await test.pool.query('SELECT id FROM external_actions WHERE approval_id=$1',[request.body.approvalId])).rows[0].id;
  return {candidateId,action,draft};
}
