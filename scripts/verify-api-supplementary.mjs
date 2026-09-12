import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {auxiliaryFixture} from './support/auxiliary-fixture.mjs';
import {consumeOfficialValidation} from '../apps/worker/src/api-validation.ts';
import {createSimulatorTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
const test=await openAcceptance({databaseKey:'api-supplementary-'+Date.now()});
const cases=new Map(),calls=[];let counter=0;
async function setting(cap=100){
 const current=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 const snapshot={...current.snapshot,jsDailyWireCap:cap};const version=current.version+1;
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'supplement-fixture',$2::jsonb)",[version,JSON.stringify(snapshot)]);return {snapshot,version};
}
async function candidate(label,config={}){
 const current=await setting(),keyword='Supplement '+label+' '+test.runId;
 const row=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[keyword])).rows[0];
 const ctx={candidateId:row.id,inputVersion:1,keyword,settingsVersion:current.version,snapshot:current.snapshot,accountScope:'supplement:'+test.runId+':'+label};
 for(const [field,value] of [['top_price','30'],['standard_size','true'],['differentiation','true']]){
  if(field==='top_price'&&config.autoPrice)continue;
  await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at) VALUES($1,$2,'measured',$3,'synthetic-manual',now())",[row.id,field,value]);
 }
 const fixture={...config,context:ctx,asin:'B0ZZ'+String(++counter).padStart(6,'0')};
 await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[row.id,JSON.stringify({representativeAsin:fixture.asin,actor:'fixture-manual-selection'})]);
 cases.set(keyword,fixture);return fixture;
}
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const text=Buffer.concat(chunks).toString(),body=text?JSON.parse(text):null;
 const url=new URL(req.url,'http://127.0.0.1');const keyword=body?.data?.attributes?.include_keywords?.[0]??body?.data?.attributes?.search_terms?.[0]??url.searchParams.get('keyword');
 const fixture=cases.get(keyword)??[...cases.values()].find(c=>c.asin===url.searchParams.get('asin'));
 if(!fixture){res.writeHead(404).end();return;}
 calls.push({path:url.pathname,keyword:fixture.context.keyword,body,query:Object.fromEntries(url.searchParams)});
 let payload;
 if(url.pathname==='/api/product_database_query')payload={data:[{id:'us/'+fixture.asin,type:'product_database_result',attributes:{price:30,reviews:100,category:'Kitchen & Dining',parent_asin:null,is_variant:false,approximate_30_day_units_sold:null,approximate_30_day_revenue:null,updated_at:new Date().toISOString()}}],links:{next:null}};
 else payload=auxiliaryFixture(url,body);
 if(url.pathname==='/api/product_database_query'&&fixture.catalogKnown)Object.assign(payload.data[0].attributes,{is_parent:false,variants:[],approximate_30_day_units_sold:100,approximate_30_day_revenue:9000});
 if(url.pathname==='/api/keywords/keywords_by_keyword_query'){
  if(fixture.pages&&!url.searchParams.has('page[cursor]'))payload={data:[{...payload.data[0],id:'us/related',attributes:{...payload.data[0].attributes,name:'related'}}],links:{next:'https://developer.junglescout.com/api/keywords/keywords_by_keyword_query?marketplace=us&page[cursor]=next'}};
  if(fixture.relatedOnly)payload={data:[{...payload.data[0],id:'us/related',attributes:{...payload.data[0].attributes,name:'related',monthly_search_volume_exact:987654,monthly_search_volume_broad:987655,monthly_trend:99,quarterly_trend:98}}],links:{next:null}};
  if(fixture.wrongMarket)payload.data[0].attributes.country='ca';
  if(fixture.changeInput)await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[fixture.context.candidateId]);
 }
 if(url.pathname==='/api/sales_estimates_query'&&fixture.missingDay)payload.data[0].attributes.data.pop();
 if(url.pathname==='/api/sales_estimates_query'&&fixture.emptySales)payload.data=[];
 if(url.pathname==='/api/sales_estimates_query'&&fixture.familyConflict)Object.assign(payload.data[0].attributes,{parent_asin:'B0ZZ999999',is_variant:true,is_standalone:false});
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(payload));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const transport=createSimulatorTransport('http://127.0.0.1:'+server.address().port,'development');
try{
 const automaticPrice=await candidate('automatic-leader',{catalogKnown:true,autoPrice:true});
 assert.equal(await consumeOfficialValidation(test.pool,transport,automaticPrice.context),'pass','The full query leader price must not require manually seeded price evidence');
 const leaderView=(await test.call('/api/candidates/'+automaticPrice.context.candidateId)).body;
 assert.equal(leaderView.validation.input.topPriceUsd.kind,'estimate');
 assert.equal(leaderView.validation.input.topPriceUsd.value,'30.00');
 assert.equal(leaderView.evidence.find(e=>e.field==='api_market_leader_family')?.value_text,automaticPrice.asin);
 for(const basis of ['old-input','old-settings','current']){
  const versioned=await candidate('canonical-'+basis),ctx=versioned.context;
  await test.pool.query('UPDATE evidence SET input_version=1,settings_version=$2 WHERE candidate_id=$1',[ctx.candidateId,basis==='old-settings'?ctx.settingsVersion-1:ctx.settingsVersion]);
  if(basis==='old-input'){
   await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[ctx.candidateId]);
   ctx.inputVersion=2;
   await test.pool.query("UPDATE candidate_events SET input_version=2 WHERE candidate_id=$1 AND stage='api_validation'",[ctx.candidateId]);
  }
  const expected=basis==='current'?'pass':'hold';
  assert.equal(await consumeOfficialValidation(test.pool,transport,ctx),expected,basis+' canonical evidence must match the current candidate view');
  const detail=(await test.call('/api/candidates/'+ctx.candidateId)).body;
  assert.equal(detail.validation.input.topPriceUsd.kind,'estimate','Leader pricing is derived from the current query, not stale manual evidence');
  for(const [field,key] of [['standard_size','standardSize'],['differentiation','differentiation']]){
   assert.equal(detail.validation.input[key].kind,basis==='current'?'measured':'unknown',basis+' '+field);
   assert.equal(detail.evidence.some(e=>e.field===field),basis==='current');
  }
 }
 const known=await candidate('known-catalog',{catalogKnown:true});
 await consumeOfficialValidation(test.pool,transport,known.context);
 const aligned=(await test.call('/api/candidates/'+known.context.candidateId)).body;
 assert.equal(aligned.evidence.find(e=>e.field==='api_sales_revenue:'+known.asin)?.value_text,'18000.00','Even populated catalog sales need the shared explicit 30-day window');
 const incompleteKnown=await candidate('known-catalog-missing-day',{catalogKnown:true,missingDay:true});
 assert.equal(await consumeOfficialValidation(test.pool,transport,incompleteKnown.context),'hold','Catalog estimates cannot replace a missing day in the comparison window');
 for(const failure of ['emptySales','familyConflict']){
  const unavailable=await candidate('known-catalog-'+failure,{catalogKnown:true,[failure]:true});
  assert.equal(await consumeOfficialValidation(test.pool,transport,unavailable.context),'hold','Inconsistent or absent sales sources cannot reuse catalog estimates');
 }
 const full=await candidate('full');assert.equal(await consumeOfficialValidation(test.pool,transport,full.context),'pass');
 const view=await test.call('/api/candidates/'+full.context.candidateId);assert.equal(view.status,200);
 const fact=field=>view.body.evidence.find(e=>e.field===field);
 assert.equal(fact('api_keyword_exact_30d').value_numeric,'1200');assert.equal(fact('api_keyword_monthly_trend').value_numeric,'-10');
 assert.equal(fact('api_sales_units:'+full.asin).value_numeric,'600');assert.equal(fact('api_sales_revenue:'+full.asin).value_text,'18000.00');assert.equal(fact('api_sales_revenue:'+full.asin).kind,'estimate');
 assert.equal(fact('api_sov_exposure_pct').value_numeric,'75');assert.ok(view.body.candidate.unknowns.some(v=>v.includes('매출 점유율')));
 assert.equal(view.body.validation.sourceCount,5);assert.equal(new Set(calls.filter(c=>c.keyword===full.context.keyword).map(c=>c.path)).size,5);
 await test.pool.query('UPDATE candidates SET input_version=2 WHERE id=$1',[full.context.candidateId]);
 assert.ok((await test.call('/api/candidates/'+full.context.candidateId)).body.evidence.every(e=>!e.field.startsWith('api_')),'New input hides old API facts');
 const partial=await candidate('partial',{missingDay:true});assert.equal(await consumeOfficialValidation(test.pool,transport,partial.context),'hold');
 const partialView=(await test.call('/api/candidates/'+partial.context.candidateId)).body;
 assert.equal(partialView.evidence.find(e=>e.field==='api_sales_units:'+partial.asin).kind,'unknown');
 const wrong=await candidate('wrong',{wrongMarket:true});assert.equal(await consumeOfficialValidation(test.pool,transport,wrong.context),'hold');
 assert.equal(calls.filter(c=>c.keyword===wrong.context.keyword).length,2,'Wrong-market data cannot unlock later paid requests');
 const related=await candidate('related-only',{relatedOnly:true});
 await consumeOfficialValidation(test.pool,transport,related.context);
 const relatedView=(await test.call('/api/candidates/'+related.context.candidateId)).body;
 for(const field of ['api_keyword_exact_30d','api_keyword_broad_30d','api_keyword_monthly_trend','api_keyword_quarterly_trend']){
  const row=relatedView.evidence.find(e=>e.field===field);assert.ok(row,field+' must be visible as unknown');
  assert.equal(row.kind,'unknown',field+' cannot borrow a related US keyword value');
  assert.equal(row.reason,'EXACT_KEYWORD_MISSING');assert.equal(row.value_numeric,null);assert.equal(row.value_text,null);
 }
 assert.equal(calls.filter(c=>c.keyword===related.context.keyword&&c.path.includes('keywords_by_keyword_query')).length,1,'Terminal related-only response is not retried');
 const stale=await candidate('stale',{changeInput:true});assert.equal(await consumeOfficialValidation(test.pool,transport,stale.context),'stale');
 assert.ok((await test.call('/api/candidates/'+stale.context.candidateId)).body.evidence.every(e=>!e.field.startsWith('api_')));
 const paged=await candidate('paged',{pages:true});assert.equal(await consumeOfficialValidation(test.pool,transport,paged.context),'pass');
 const keywordCalls=calls.filter(c=>c.keyword===paged.context.keyword&&c.path.includes('keywords_by_keyword_query'));assert.equal(keywordCalls.length,2);assert.deepEqual(keywordCalls[0].body,keywordCalls[1].body);assert.equal(keywordCalls[1].query['page[cursor]'],'next');
 const paused=await candidate('paused');const spent=Number((await test.pool.query('SELECT COALESCE(sum(consumed+reserved),0)::int AS n FROM budget_days')).rows[0].n);
 const limited=await setting(spent+2);paused.context={...paused.context,settingsVersion:limited.version,snapshot:limited.snapshot};
 assert.equal(await consumeOfficialValidation(test.pool,transport,paused.context),'blocked');assert.equal(calls.filter(c=>c.keyword===paused.context.keyword).length,2);
 const resumed=await setting(spent+5);paused.context={...paused.context,settingsVersion:resumed.version,snapshot:resumed.snapshot};
 assert.equal(await consumeOfficialValidation(test.pool,transport,paused.context),'pass');assert.equal(calls.filter(c=>c.keyword===paused.context.keyword).length,5,'Resume reuses prior endpoint caches');
 console.log(JSON.stringify({scenario:'api-supplementary',result:'PASS',allFiveEndpoints:true,exactKeywordOnly:true,sales30Days:true,incompleteDaysUnknown:true,exposureNotRevenue:true,versionGuard:true,keywordPagination:true,budgetResume:true,externalCalls:0}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await test.close();}
