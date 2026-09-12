import assert from 'node:assert/strict';
import {runCandidateAiWork} from '../../apps/worker/src/ai-business.ts';

export async function automaticSpecUiFixture(test){
 const stored=await test.call('/api/custom-ai',{version:0,name:'Synthetic proposal source',model:'fixture-only',baseUrl:'https://fixture.invalid/v1',apiKey:'SYNTHETIC_SPEC_UI_KEY',dailyBudgetUsd:'1',roles:['sourcing_analysis'],priority:1,inputUsdPerMillion:'1',outputUsdPerMillion:'1',maxInputTokens:4096,maxOutputTokens:2048});
 assert.equal(stored.status,201);
 const grant=await test.call(`/api/custom-ai/${stored.body.profile.id}/activation-proposals`,{version:1});assert.equal((await test.call(`/api/approvals/${grant.body.approvalId}/approve`,{})).status,200);
 const id=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",['실리콘 주걱 · 사양 제안 검증 '+test.runId])).rows[0].id;
 const version=(await test.call('/api/settings')).body.version;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[id,version,JSON.stringify({synthetic:true,inputVersion:1})]);
 const target={material:'실리콘 목표',dimensions:'길이 30 cm 목표',packaging:'개별 포장 목표',requirements:'공급처가 재질·치수·포장을 확인해야 합니다.',requestedQuantity:300,rationale:'견적 비교를 위해 제안한 목표이며 제품 실측 자료가 아닙니다.',sourceRefs:['subject']};
 const transport={kind:'ready',send:async()=>({kind:'response',status:200,body:{choices:[{message:{content:JSON.stringify({role:'sourcing_analysis',summary:'합성 사양 제안',suggestions:[],searchQueries:['silicone spatula'],targetSpecification:target})}}],usage:{prompt_tokens:100,completion_tokens:100}}})};
 assert.equal((await runCandidateAiWork(test.pool,id,'sourcing_analysis',{transport,encryptionKey:Buffer.from(test.encryptionKeyHex,'hex')})).kind,'succeeded');
 const spec=(await test.call(`/api/candidates/${id}/sourcing`)).body.specs[0];assert.ok(spec.aiTaskId);
 const supplier=await test.call(`/api/candidates/${id}/suppliers`,{name:'합성 공급처',email:'supplier@fixture.invalid',source:'Synthetic UI fixture only',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Synthetic match solely for UI verification',specId:spec.id});assert.equal(supplier.status,201);
 const known=value=>({value,kind:'quote',source:'Synthetic UI quote only',observedAt:new Date().toISOString()});
 const quote=await test.call(`/api/candidates/${id}/quotes`,{specId:spec.id,supplierName:'합성 공급처',supplierSource:'Synthetic UI fixture only',sourceText:'Synthetic quote; not a real supplier response',receivedAt:new Date().toISOString(),validUntil:'2030-01-01',incoterm:'DDP',quantity:300,moq:300,risksConfirmed:true,riskSource:'Synthetic risk fixture only',costs:{salePrice:known('30'),productUnitPrice:known('5'),unitFreight:known('1'),unitDuty:known('0'),unitPrepInspection:known('0'),otherLandedUnitCost:known('0'),fbaFee:known('4.5'),referralFee:known('4.5'),adsPerUnit:known('2'),expectedReturnLoss:known('0.5'),otherVariableCost:known('0.5'),separateUpfrontCosts:known('200'),initialAdCash:known('300'),contingencyCash:known('300')}});assert.equal(quote.status,201);
 const packet=await test.call(`/api/candidates/${id}/order-packets`,{quoteId:quote.body.id,decision:'hold',note:'Synthetic provenance review only'});assert.equal(packet.status,201);assert.equal(packet.body.packet.snapshot.source.spec.aiTaskId,spec.aiTaskId);
 return {candidateId:id,specId:spec.id,quoteId:quote.body.id,packetId:packet.body.packet.id,entryPath:'/sourcing?candidate='+id,syntheticProposalPipeline:true};
}
