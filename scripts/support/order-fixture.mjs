import assert from "node:assert/strict";
import {orderValidationFixture} from './order-market-fixture.mjs';
export async function createOrderFixture(test,label){
 const at=new Date().toISOString();
 const known=value=>({value,kind:"quote",source:"synthetic local order API fixture",observedAt:at});
  const inserted=await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'economics_review') RETURNING id",[`QA API order ${label} ${test.runId}`]);
  const id=inserted.rows[0].id;
  const settings=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
  await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale) VALUES($1,$2,'api_validation','pass',$3::jsonb,false)",[id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot))]);
  const spec=await test.call(`/api/candidates/${id}/specs`,{material:'synthetic',dimensions:'30 cm',packaging:'synthetic',requirements:'fixture only',requestedQuantity:300,source:'local fixture'});
  assert.equal(spec.status,201);
  const quote=await test.call(`/api/candidates/${id}/quotes`,{specId:spec.body.id,supplierName:'Synthetic A',supplierSource:'local fixture',sourceText:'synthetic local acceptance',receivedAt:at,validUntil:'2030-01-01',incoterm:'DDP',quantity:300,moq:300,risksConfirmed:true,riskSource:'local fixture',costs:{salePrice:known('30'),productUnitPrice:known('5'),unitFreight:known('1'),unitDuty:known('0'),unitPrepInspection:known('0'),otherLandedUnitCost:known('0'),fbaFee:known('4.5'),referralFee:known('4.5'),adsPerUnit:known('2'),expectedReturnLoss:known('0.5'),otherVariableCost:known('0.5'),separateUpfrontCosts:known('200'),initialAdCash:known('300'),contingencyCash:known('300')}});
  assert.equal(quote.status,201);
  return {id,quoteId:quote.body.id,specId:spec.body.id};
 }

export function riskReview(specId,status='clear',overrides={}){
 const at=new Date().toISOString().slice(0,10);
 const check=key=>({
  status:overrides[key]?.status??status,
  source:overrides[key]?.source??'synthetic local risk fixture',
  observedOn:overrides[key]?.observedOn??at,
 });
 return {
  kind:'operator_record',
  scope:{inputVersion:1,representativeAsin:null,specId},
  checks:{brand:check('brand'),returns:check('returns'),selling:check('selling')},
  recordedOn:at,
 };
}
