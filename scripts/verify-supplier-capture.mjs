import assert from 'node:assert/strict';
import {prepareAutomaticRfqs} from '../apps/worker/src/automatic-rfq.ts';
import {openAcceptance} from './support/acceptance.mjs';
import {persistSupplierCapture} from '../packages/integrations/src/sourcing/capture.ts';
import {compareCapturedSpec} from '../packages/domain/src/supplier-capture.ts';
import {decryptSecret} from '../packages/security/src/secrets.ts';
const test=await openAcceptance({databaseKey:'supplier-capture-api-acceptance'});
try {
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id,input_version",['Synthetic capture '+test.runId])).rows[0];
 const settings=(await test.call('/api/settings')).body.version;
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[candidate.id,settings,JSON.stringify({synthetic:true,inputVersion:candidate.input_version})]);
 const requested={material:'steel',dimensions:'30 cm',packaging:'box',requirements:'sample inspection'};
 const spec=(await test.call('/api/candidates/'+candidate.id+'/specs',{...requested,requestedQuantity:300,source:'Synthetic capture verification'})).body;
 const capture={candidateId:candidate.id,specId:spec.id,inputVersion:candidate.input_version,settingsVersion:settings,searchQuery:'synthetic steel tray',companyUrl:'https://fixture.alibaba.com/',productUrl:'https://www.alibaba.com/product-detail/synthetic.html',observedAt:new Date().toISOString(),pageText:'Synthetic Supplier\ncontact@fixture.invalid\nMaterial: steel\nDimensions: 30 cm\nPackaging: box\nRequirements: sample inspection',companyName:'Synthetic Supplier',email:'contact@fixture.invalid',observedSpec:Object.fromEntries(Object.entries(requested).map(([key,value])=>[key,{value,excerpt:key[0].toUpperCase()+key.slice(1)+": "+value}]))};
 assert.equal(compareCapturedSpec({...capture,pageText:capture.pageText.replace('Material: steel','Not material: steel'),observedSpec:{...capture.observedSpec,material:{value:'steel',excerpt:'Not material: steel'}}},requested),'unknown');
 const key=Buffer.from(test.encryptionKeyHex,'hex');
 const input={capture,encryptionKey:key};
 const unauthenticated=await test.app.inject({method:'POST',url:'/api/candidates/'+candidate.id+'/supplier-captures',payload:capture});
 assert.equal(unauthenticated.statusCode,401);
 const results=(await Promise.all([test.call('/api/candidates/'+candidate.id+'/supplier-captures',capture),test.call('/api/candidates/'+candidate.id+'/supplier-captures',capture)])).map(r=>{assert.ok([200,201].includes(r.status));return r.body;});
 assert.deepEqual(results.map(r=>r.kind).sort(),['duplicate','stored']);
 assert.equal(results[0].supplierId,results[1].supplierId);
 const stored=(await test.pool.query('SELECT * FROM supplier_captures WHERE candidate_id=$1',[candidate.id])).rows;
 assert.equal(stored.length,1);assert.equal(stored[0].capture_method,'user_declared');
 assert.deepEqual(JSON.parse(decryptSecret(stored[0].body_ciphertext,key,'supplier-capture:'+stored[0].id).toString()),capture);
 assert.equal(stored[0].body_ciphertext.includes('contact@fixture.invalid'),false);
 const metadata=await test.call('/api/candidates/'+candidate.id+'/supplier-captures');
 assert.equal(metadata.status,200);assert.equal(metadata.body.captures[0].captureMethod,'user_declared');
 assert.equal(JSON.stringify(metadata.body).includes('body_ciphertext'),false);
 const view=(await test.call('/api/candidates/'+candidate.id+'/contact')).body;
 assert.equal(view.suppliers.length,1);assert.equal(view.suppliers[0].specId,spec.id);assert.equal(view.suppliers[0].matchStatus,'matches');
 assert.equal(await prepareAutomaticRfqs(test.pool,candidate.id),1);
 const drafts=await test.pool.query('SELECT state FROM rfq_drafts WHERE candidate_id=$1',[candidate.id]);
 assert.equal(drafts.rows[0].state,'pending_approval');
 assert.equal((await test.pool.query('SELECT count(*)::int AS count FROM external_actions a JOIN rfq_drafts r ON r.id=a.rfq_id WHERE r.candidate_id=$1',[candidate.id])).rows[0].count,0);
 assert.equal((await persistSupplierCapture(test.pool,{...input,capture:{...capture,settingsVersion:settings-1}})).kind,'stale');
 for(const patch of [{email:'invented@fixture.invalid'},{email:'tact@fixture.invalid'},{companyUrl:'https://alibaba.com.evil.invalid/'},{cookie:'private'},{observedAt:'2999-01-01T00:00:00.000Z'},{observedSpec:{...capture.observedSpec,material:{value:'gold',excerpt:'gold'}}}]){
  assert.equal((await persistSupplierCapture(test.pool,{...input,capture:{...capture,...patch}})).kind,'invalid');
 }
 assert.equal((await persistSupplierCapture(test.pool,{...input,capture:{...capture,inputVersion:candidate.input_version+1}})).kind,'stale');
 const unknown=await persistSupplierCapture(test.pool,{...input,capture:{...capture,observedSpec:{...capture.observedSpec,requirements:null}}});
 assert.equal(unknown.kind,'stored');
 assert.equal((await test.pool.query('SELECT match_status FROM sourcing_suppliers WHERE id=$1',[unknown.supplierId])).rows[0].match_status,'unknown');
 await test.call('/api/candidates/'+candidate.id+'/specs',{...requested,material:'wood',requestedQuantity:300,source:'Synthetic later revision'});
 assert.equal((await persistSupplierCapture(test.pool,input)).kind,'stale');
 assert.equal((await test.pool.query('SELECT count(*)::int AS count FROM supplier_captures WHERE candidate_id=$1',[candidate.id])).rows[0].count,2);
 console.log(JSON.stringify({scenario:'supplier-capture',result:'PASS',encryptedProvenance:true,concurrentReplayDeduplicated:true,unknownPreserved:true,staleSpecBlocked:true,captureToRfqApproval:true,actualBrowserCollection:false,externalCalls:0}));
} finally {await test.close();}
