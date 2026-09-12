import { runSummaryDeliveryCycle } from "../../apps/worker/src/summary-delivery-loop.ts";
import { createMailpitTransport } from "../../packages/integrations/src/mail/mailpit.ts";
import { prepareReadyRfqs } from "../../apps/worker/src/automatic-rfq.ts";
import { runCandidateAiWork } from "../../apps/worker/src/ai-business.ts";
import {auxiliaryFixture} from "./auxiliary-fixture.mjs";
import {consumeOfficialValidation} from "../../apps/worker/src/api-validation.ts";
import {runDailyPlanner} from "../../apps/worker/src/planner.ts";
import {PgBoss} from "pg-boss";
import {createInboxFixture} from "./inbox-fixture.mjs";
import assert from "node:assert/strict";
import {approvedRfq} from "./approved-rfq.mjs";
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../../apps/web/node_modules/vite/dist/node/index.js';
import {openAcceptance} from './acceptance.mjs';
import {createOrderFixture} from './order-fixture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const webOrigin='http://127.0.0.1:5174';
const inboxMode=process.argv.includes('--inbox');
const enrollmentMode=process.argv.includes('--enrollment');
const inboxKeyHex='72'.repeat(32);
let uiAiCalls=0;
const uiAiTransport=process.argv.includes('--ai-execution')?{kind:'ready',send:async input=>{console.log(JSON.stringify({syntheticAiCall:++uiAiCalls,model:input.model}));
if(process.argv.includes('--ai-business')&&input.messages.length===2){
 const data=JSON.parse(input.messages[1].content);
 const output={role:data.role,summary:'입력된 제품 정보에 대한 AI 제안입니다. 아직 확인하지 않은 시장 수치와 공급 조건은 추가 확인이 필요합니다.',suggestions:[{text:'수치가 미확인인 항목은 원본 자료로 확인한 뒤 비교하세요.',sourceRefs:[data.spec?'spec':data.evidence[0]?.ref??'subject']}],...(data.role==='normalize'?{normalizedKeyword:'silicone spatula'}:{}),...(data.role==='sourcing_analysis'?{searchQueries:['silicone spatula manufacturer','heat resistant spatula supplier']}:{}),...(data.role==='rfq_draft'?{draftText:'Please confirm MOQ, unit pricing and DDP shipping for the requested specification. Please also provide packaging dimensions and lead time.'}:{})};
 return {kind:'response',status:200,body:{choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:100}}};
}
return {kind:'response',status:200,body:{choices:[{message:{content:'{"forge_test":"ok"}'}}],usage:{prompt_tokens:9,completion_tokens:4}}};}}:undefined;
const test=await openAcceptance({aiTransport:uiAiTransport,webOrigin,unenrolled:enrollmentMode,databaseKey:process.argv.includes('--custom-ai')?'custom-ai-ui-'+Date.now():enrollmentMode?'enrollment-ui-'+Date.now():inboxMode?'inbox-ui-'+Date.now():process.argv.includes('--fresh-mail')?'mail-ui-'+Date.now():'acceptance-order-ui',...(inboxMode?{encryptionKeyHex:inboxKeyHex,mailTransport:'profile'}:{})});
let vite;
let summaryMailTimer;
let summaryMailBoss;
let autoRfqTimer;
try {
 const subject=enrollmentMode?{}:inboxMode?await createInboxFixture(test,Buffer.from(inboxKeyHex,'hex'),{includeComplete:true,includeAlternate:true}):await createOrderFixture(test,'browser');
 if(process.argv.includes('--summary')){
  await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'summary-ui-fixture',snapshot || $1::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1",[JSON.stringify({timezone:'America/Chicago',researchStartLocalTime:'00:00',summaryLocalTime:'00:00'})]);
  const planner=new PgBoss({connectionString:test.databaseUrl,migrate:false,supervise:false,schedule:false});await planner.start();
  try{await runDailyPlanner(test.pool,planner,{apiAvailable:false});}finally{await planner.stop({graceful:false,timeout:2000});}
 }
 if(process.argv.includes('--api-context')){
  await test.pool.query("UPDATE candidates SET stage='api_validation' WHERE id=$1",[subject.id]);
  const previous=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
  const snapshot={...previous.snapshot,jsDailyWireCap:100};const version=previous.version+1;
  await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'api-ui-fixture',$2::jsonb)",[version,JSON.stringify(snapshot)]);
  const keyword=(await test.pool.query('SELECT keyword_display FROM candidates WHERE id=$1',[subject.id])).rows[0].keyword_display;
  const transport={kind:'ready',send:async input=>{
   const url=new URL(input.path,'https://developer.junglescout.com');
   const body=url.pathname==='/api/product_database_query'?{data:[{id:'us/B0ZZ123456',type:'product_database_result',attributes:{price:30,reviews:100,category:'Kitchen & Dining',parent_asin:null,is_variant:false,approximate_30_day_units_sold:null,approximate_30_day_revenue:null,updated_at:new Date().toISOString()}}],links:{next:null}}:auxiliaryFixture(url,input.body);
   return {status:200,body,retryAfter:null};
  }};
  await consumeOfficialValidation(test.pool,transport,{candidateId:subject.id,inputVersion:1,keyword,settingsVersion:version,snapshot,accountScope:'api-ui-fixture'});
 }
 if(process.argv.includes('--custom-ai')){
  const profiles=[];
  for(const [name,role,priority] of [['Synthetic input assistant','normalize',1],['Synthetic RFQ assistant','rfq_draft',2]]){
   const result=await test.call('/api/custom-ai',{name,baseUrl:'https://model.fixture.invalid/v1',model:'synthetic-model',apiKey:'SYNTHETIC_UI_KEY_7392',dailyBudgetUsd:'2.00',version:0,roles:process.argv.includes('--ai-business')?['normalize','niche_analysis','sourcing_analysis','rfq_draft']:[role],priority,inputUsdPerMillion:'1.00',outputUsdPerMillion:'2.00',maxInputTokens:process.argv.includes('--ai-business')?4096:1024,maxOutputTokens:process.argv.includes('--ai-business')?1024:256,retentionPolicyUrl:null});
   assert.equal(result.status,201);profiles.push(result.body.profile.id);
  }
  subject.aiProfileIds=profiles;
  if(process.argv.includes('--ai-business')){
   const approval=await test.call(`/api/custom-ai/${profiles[0]}/activation-proposals`,{version:1});assert.equal(approval.status,201);
   assert.equal((await test.call(`/api/approvals/${approval.body.approvalId}/approve`,{})).status,200);
   for(const role of ['normalize','niche_analysis','sourcing_analysis','rfq_draft'])await runCandidateAiWork(test.pool,subject.id,role,{transport:uiAiTransport,encryptionKey:Buffer.from(test.encryptionKeyHex,'hex')});
  }
 }
 if(process.argv.includes('--ai-rfq-ui')){
  const supplier=await test.call(`/api/candidates/${subject.id}/suppliers`,{name:'Synthetic RFQ recipient',email:'supplier@fixture.invalid',source:'synthetic UI fixture',observedAt:new Date().toISOString(),matchStatus:'matches',matchNotes:'Synthetic matching specification'});assert.equal(supplier.status,201);
 }
 let contactCandidateId;
 if(!inboxMode&&process.argv.includes('--approval-navigation')){
   const order=await test.call(`/api/candidates/${subject.id}/order-packets`,{quoteId:subject.quoteId,decision:'hold',note:'Synthetic navigation acceptance only'});
   assert.equal(order.status,201);
   const contact=await approvedRfq(test,'navigation');
   const approval=(await test.pool.query('SELECT approval_id FROM external_actions WHERE id=$1',[contact.action])).rows[0];
   assert.equal((await test.call(`/api/approvals/${approval.approval_id}/reject`,{})).status,200);
   assert.equal((await test.call(`/api/rfqs/${contact.draft.id}/approval`,{})).status,201);
   contactCandidateId=contact.candidateId;
 }

 if(process.argv.includes('--search-runs')){
  const search=await test.call('/api/saved-searches',{name:'주방용품 원본 보존 확인 · 합성 조사',filters:{priceMinUsd:'17',competition:'상위 상품 리뷰 분포 확인'}});assert.equal(search.status,201);
  const run=await test.call(`/api/saved-searches/${search.body.id}/run`,{});assert.equal(run.status,202);
  const boundary='saved-search-ui-'+test.runId;
  const csv=['keyword,top_price','synthetic search spoon '+test.runId+',30','synthetic search tray '+test.runId+',',''].join(String.fromCharCode(10));
  const file=Buffer.from([`--${boundary}`,'Content-Disposition: form-data; name="file"; filename="synthetic-search.csv"','Content-Type: text/csv','',csv,`--${boundary}--`,''].join(String.fromCharCode(13,10)));
  assert.equal((await test.call(`/api/imports?searchRunId=${run.body.run.id}`,file,{'content-type':`multipart/form-data; boundary=${boundary}`})).status,200);
  assert.equal((await test.call(`/api/saved-searches/${search.body.id}/run`,{})).status,202);
 }
 if(process.argv.includes('--automatic-rfq')){
  const settings=(await test.call('/api/settings')).body;
  const id=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING id",['자동 견적 초안 확인 · 합성 '+test.runId])).rows[0].id;
  await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass','{\"synthetic\":true,\"inputVersion\":1}')",[id,settings.version]);
  await test.call(`/api/candidates/${id}/specs`,{material:'합성 실리콘',dimensions:'30 cm',packaging:'개별 포장',requirements:'합성 검수용 · 실제 발송 금지',requestedQuantity:300,source:'Synthetic automatic RFQ UI fixture'});
  contactCandidateId=id;
  let preparing=false;
  autoRfqTimer=setInterval(()=>{if(preparing)return;preparing=true;prepareReadyRfqs(test.pool).catch(()=>console.error('Synthetic RFQ preparation failed')).finally(()=>{preparing=false;});},1000);
 }
 if(process.argv.includes('--summary-delivery')){
  await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'summary-ui-fixture',snapshot || '{\"summaryLocalTime\":\"00:00\"}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1");
  summaryMailBoss=new PgBoss({connectionString:test.databaseUrl,migrate:false,supervise:false,schedule:false});await summaryMailBoss.start();
  let working=false;
  summaryMailTimer=setInterval(()=>{if(working)return;working=true;(async()=>{
   const current=(await test.pool.query('SELECT snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
   if(current.snapshot.summaryEmailEnabled!==true)return;
   await runDailyPlanner(test.pool,summaryMailBoss,{apiAvailable:false});
   await runSummaryDeliveryCycle(test.pool,async()=>createMailpitTransport('development'));
  })().catch(()=>console.error('Synthetic summary delivery failed')).finally(()=>{working=false;});},1000);
 }
 const apiOrigin=await test.app.listen({port:0,host:'127.0.0.1'});
 vite=await createServer({root:join(root,'apps/web'),configFile:join(root,'apps/web/vite.config.ts'),server:{host:'127.0.0.1',port:5174,strictPort:true,proxy:{'/api':{target:apiOrigin,changeOrigin:false}}}});
 await vite.listen();
 const fixturePath=join(tmpdir(),`forge-order-ui-${test.runId}.json`);
 await writeFile(fixturePath,JSON.stringify({...test.authFixture,...subject,contactCandidateId,webOrigin}),{mode:0o600});
 console.log(JSON.stringify({ready:true,webOrigin,fixturePath,database:test.database,runId:test.runId}));
 const close=async()=>{if(summaryMailTimer)clearInterval(summaryMailTimer);if(summaryMailBoss)await summaryMailBoss.stop({graceful:false,timeout:2000});if(autoRfqTimer)clearInterval(autoRfqTimer);await vite.close();await test.close();process.exit(0);};
 process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
}catch(error){if(vite)await vite.close();await test.close();throw error;}
