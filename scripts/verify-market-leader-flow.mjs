import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {auxiliaryFixture} from './support/auxiliary-fixture.mjs';
import {consumeOfficialValidation} from '../apps/worker/src/api-validation.ts';
import {createSimulatorTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {dispatchBrowserWork} from '../apps/worker/src/browser-dispatch.ts';
import {advanceCandidate} from '../apps/worker/src/advance-candidate.ts';
const test=await openAcceptance({databaseKey:'market-leader-flow-'+Date.now()});
const cases=new Map(),sales=new Map(),calls=[];let sequence=0;
async function fixture(label,options={}){
 const latest=(await test.pool.query('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0];
 const snapshot={...latest.snapshot,jsDailyWireCap:500,productDatabaseMaxPages:options.partial?1:3},version=latest.version+1;
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'leader-flow-fixture',$2::jsonb)",[version,JSON.stringify(snapshot)]);
 const keyword='Synthetic leader '+label+' '+test.runId;
 const id=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[keyword])).rows[0].id;
 for(const [field,value] of [['top_price','10'],['standard_size','true'],['differentiation','true']])await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at) VALUES($1,$2,'measured',$3,'synthetic-old-source',now())",[id,field,value]);
 const base=++sequence*10,asins=Array.from({length:4},(_,i)=>'B0LM'+String(base+i).padStart(6,'0')),parent='B0LM'+String(base+9).padStart(6,'0');
 const products=asins.map((asin,i)=>({id:'us/'+asin,type:'product_database_result',attributes:{price:i<2?(options.ambiguous&&i===1?29:27):i===2?45:55,reviews:100,category:'Kitchen & Dining',parent_asin:i<2?parent:null,is_variant:i<2,is_parent:false,variants:[],approximate_30_day_units_sold:9999,approximate_30_day_revenue:999999,updated_at:new Date().toISOString()}}));
 products.forEach((row,i)=>sales.set(asins[i],{family:{parent_asin:row.attributes.parent_asin,is_variant:i<2,is_parent:false,is_standalone:i>=2,variants:[]},units:i<2?100:i===2?(options.tie?40:20):40}));
 sales.set(parent,{family:{parent_asin:null,is_variant:false,is_parent:true,is_standalone:false,variants:options.missingMembership?[]:asins.slice(0,2)},units:options.parentWins?100:10,missingDay:options.missingDay});
 if(options.changeCanonical)sales.get(asins[3]).canonicalChange={candidateId:id,settingsVersion:version};
 await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[id,JSON.stringify(options.automatic?{}:{representativeAsin:asins[2],actor:'fixture-manual-selection'})]);
 const result={context:{candidateId:id,keyword,inputVersion:1,settingsVersion:version,snapshot,accountScope:options.worker?'local':'leader:'+test.runId+':'+label},products,asins,parent};cases.set(keyword,result);return result;
}
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const text=Buffer.concat(chunks).toString(),body=text?JSON.parse(text):null,url=new URL(req.url,'http://127.0.0.1');
 let result=auxiliaryFixture(url,body);
 if(url.pathname==='/api/product_database_query'){
  const f=cases.get(body.data.attributes.include_keywords[0]);
  result=url.searchParams.has('page[cursor]')?{data:[f.products[3],f.products[0]],links:{next:null}}:{data:f.products.slice(0,3),links:{next:'https://developer.junglescout.com/api/product_database_query?marketplace=us&page[cursor]=second'}};
 }
 if(url.pathname==='/api/sales_estimates_query'){
  const data=sales.get(url.searchParams.get('asin'));assert.ok(data);
  Object.assign(result.data[0].attributes,data.family);
  result.data[0].attributes.data.forEach(day=>{day.estimated_units_sold=data.units;});
  if(data.missingDay)result.data[0].attributes.data.pop();
  if(data.canonicalChange&&!data.changed){
   data.changed=true;
   await test.pool.query("INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at,input_version,settings_version) VALUES($1,'standard_size','measured','false','synthetic-new-package-evidence',now(),1,$2)",[data.canonicalChange.candidateId,data.canonicalChange.settingsVersion]);
  }
  calls.push(Object.fromEntries(url.searchParams));
 }
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const transport=createSimulatorTransport('http://127.0.0.1:'+server.address().port,'development');
const view=async f=>(await test.call('/api/candidates/'+f.context.candidateId)).body;
try{
 const normal=await fixture('normal');assert.equal(await consumeOfficialValidation(test.pool,transport,normal.context),'pass');
 const normalView=await view(normal);
 assert.equal(normalView.validation.input.topPriceUsd.value,'55.00','The second-page leader must replace the old manually seeded price');
 assert.equal(normalView.validation.input.topPriceUsd.kind,'estimate');
 assert.equal(normalView.validation.input.monthlyRevenueCompetitorCount.value,3,'Child sales must not double-count families');
 assert.equal(normalView.evidence.find(e=>e.field==='api_market_leader_family').value_text,normal.asins[3]);
 assert.equal(calls.length,5,'Four unique catalog ASINs plus one shared parent are queried once');
 assert.equal(calls.filter(c=>c.asin===normal.parent).length,1);assert.equal(new Set(calls.map(c=>c.start_date+'|'+c.end_date)).size,1);
 assert.equal((await test.call('/api/candidates/'+normal.context.candidateId+'/representative')).body.selectedAsin,normal.asins[2],'An explicit representative must survive a different market leader');
 const automatic=await fixture('automatic',{automatic:true,worker:true});
 assert.equal(await consumeOfficialValidation(test.pool,transport,automatic.context),'hold','Automatic selection must not inherit unbound package or differentiation evidence');
 const selected=(await test.call('/api/candidates/'+automatic.context.candidateId+'/representative')).body;
 assert.equal(selected.selectedAsin,automatic.asins[3],'Select only the unique full-population leading ASIN');
 assert.equal(selected.inputVersion,1,'Initial selection must preserve collected market source identity');
 const automaticView=await view(automatic);
 assert.equal(automaticView.validation.input.standardSize.kind,'unknown');assert.equal(automaticView.validation.input.differentiation.kind,'unknown');
 const automaticCalls=calls.length;
 assert.equal(await consumeOfficialValidation(test.pool,transport,automatic.context),'hold');
 assert.equal(calls.length,automaticCalls,'Automatic selection retries must reuse retained market calls');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM audit_events WHERE target=$1 AND action='representative_asin_auto_selected'",[automatic.context.candidateId])).rows[0].n,1);
 const keys=browserSigningFixture(),identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pairing=(await test.call('/api/bridge/pairings',{})).body;
 const enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.pairingCode,name:'Synthetic automatic representative reader'});assert.equal(enrolled.status,201);
 await test.app.listen({host:'127.0.0.1',port:0});
 const apiAddress=test.app.server.address(),apiOrigin='http://127.0.0.1:'+apiAddress.port;
 const deviceCall=async(path,body)=>{
  const response=await fetch(apiOrigin+path,{method:'POST',headers:{origin:'http://localhost:5173',authorization:'Bearer '+enrolled.body.credential,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await deviceCall('/api/bridge/capabilities',{connected:true,supportedTasks:['amazon_package'],keyFingerprint:identity.fingerprint})).status,200);
 assert.equal((await dispatchBrowserWork(test.pool,{origin:'http://localhost:5173',privateKey:keys.privateKey,fingerprint:identity.fingerprint})).queued,1);
 const packageTask=(await deviceCall('/api/bridge/tasks/claim',{})).body;
 const packageRequest=JSON.parse(Buffer.from(packageTask.envelope.payload,'base64url')).request;
 assert.equal(packageRequest.candidateId,automatic.context.candidateId);assert.equal(packageRequest.asin,selected.selectedAsin);
 const rows=[{label:'ASIN',value:selected.selectedAsin},{label:'Package Dimensions',value:'10 x 4 x 2 inches; 1 pounds'}].map(row=>({...row,excerpt:row.label+' '+row.value}));
 const packageObservation={protocol:1,kind:'captured',scope:'amazon_product_page',asin:selected.selectedAsin,sourcePageUrl:'https://www.amazon.com/dp/'+selected.selectedAsin,observedAt:new Date().toISOString(),snapshot:'Synthetic automatic representative package',pageText:rows.map(row=>row.excerpt).join('\n'),rows,productEvidence:{basis:'listing_claims_and_review_excerpts',title:'Synthetic representative utensil',claims:['Silicone blade'],reviews:[]}};
 const packageResult=await deviceCall('/api/bridge/tasks/'+packageTask.taskId+'/results',{taskHash:packageTask.taskHash,observation:packageObservation});assert.equal(packageResult.status,201);
 const queuedAdvance=(await test.pool.query("SELECT data FROM pgboss.job WHERE name='candidate.advance' AND data->>'candidateId'=$1 AND state='created' ORDER BY created_on DESC LIMIT 1",[automatic.context.candidateId])).rows[0];
 assert.ok(queuedAdvance,'Accepting the package receipt must durably schedule revalidation');
 await advanceCandidate(test.pool,transport,queuedAdvance.data);
 assert.equal(calls.length,automaticCalls,'Package-triggered worker revalidation must reuse retained sales calls');
 const afterPackage=await view(automatic);
 assert.equal(afterPackage.validation.input.standardSize.kind,'measured');assert.equal(afterPackage.validation.input.standardSize.value,true);
 assert.equal(afterPackage.validation.input.differentiation.kind,'unknown');
 assert.equal((await test.call('/api/candidates/'+automatic.context.candidateId+'/product-source')).body.asin,selected.selectedAsin);
 const selectedAgain=(await test.call('/api/candidates/'+automatic.context.candidateId+'/representative')).body;
 assert.equal(selectedAgain.selectedAsin,selected.selectedAsin);assert.equal(selectedAgain.inputVersion,1);
 const ambiguousRepresentative=await fixture('automatic-family',{automatic:true,parentWins:true});
 assert.equal(await consumeOfficialValidation(test.pool,transport,ambiguousRepresentative.context),'hold','A winning family with multiple ASINs must wait for representative selection');
 assert.equal((await test.call('/api/candidates/'+ambiguousRepresentative.context.candidateId+'/representative')).body.selectedAsin,null);
 const existingSpec=await fixture('existing-spec',{automatic:true});
 const spec=(await test.pool.query("INSERT INTO spec_revisions(candidate_id,revision,material,dimensions,packaging,requirements,requested_quantity,source) VALUES($1,1,'Synthetic steel','10 x 4 x 2 in','Synthetic box','Preserve established sourcing scope',100,'Manual fixture') RETURNING *",[existingSpec.context.candidateId])).rows[0];
 assert.equal(await consumeOfficialValidation(test.pool,transport,existingSpec.context),'pass','Existing sourcing specifications must not be forced into an uneditable selection workflow');
 assert.deepEqual((await test.pool.query('SELECT * FROM spec_revisions WHERE id=$1',[spec.id])).rows[0],spec);
 assert.equal((await test.call('/api/candidates/'+existingSpec.context.candidateId+'/representative')).body.selectedAsin,null);
 const concurrent=await fixture('concurrent-auto',{automatic:true});
 const concurrentResults=await Promise.all([consumeOfficialValidation(test.pool,transport,concurrent.context),consumeOfficialValidation(test.pool,transport,concurrent.context)]);
 assert.ok(concurrentResults.includes('hold'));
 assert.equal((await test.call('/api/candidates/'+concurrent.context.candidateId+'/representative')).body.selectedAsin,concurrent.asins[3]);
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM audit_events WHERE target=$1 AND action='representative_asin_auto_selected'",[concurrent.context.candidateId])).rows[0].n,1,'Concurrent callbacks must select exactly once');
 assert.equal((await test.call('/api/candidates/'+concurrent.context.candidateId+'/representative',{asin:concurrent.asins[2],inputVersion:1})).status,200);
 const manualOverride=(await test.call('/api/candidates/'+concurrent.context.candidateId+'/representative')).body;
 assert.equal(manualOverride.selectedAsin,concurrent.asins[2]);assert.equal(manualOverride.inputVersion,2);
 assert.equal(await consumeOfficialValidation(test.pool,transport,concurrent.context),'stale','An old auto-selection callback cannot overwrite a manual override');
 assert.equal((await test.call('/api/candidates/'+concurrent.context.candidateId+'/representative')).body.selectedAsin,concurrent.asins[2]);
 const unboundFailure=await fixture('automatic-unbound-failure',{automatic:true});
 await test.pool.query("UPDATE evidence SET value_text='false' WHERE candidate_id=$1 AND field IN ('standard_size','differentiation')",[unboundFailure.context.candidateId]);
 assert.equal(await consumeOfficialValidation(test.pool,transport,unboundFailure.context),'hold','Unbound product evidence must not reject a newly selected representative');
 const parent=await fixture('parent-wins',{parentWins:true});assert.equal(await consumeOfficialValidation(test.pool,transport,parent.context),'pass');
 const parentView=await view(parent);assert.equal(parentView.validation.input.topPriceUsd.value,'27.00');assert.equal(parentView.evidence.find(e=>e.field==='api_market_leader_family').value_text,parent.parent);
 for(const options of [{tie:true},{parentWins:true,ambiguous:true},{missingMembership:true},{missingDay:true},{partial:true}]){
  const f=await fixture('held-'+sequence,options);assert.equal(await consumeOfficialValidation(test.pool,transport,f.context),'hold');
  const held=await view(f);assert.equal(held.validation.input.topPriceUsd.kind,'unknown');
  assert.equal(held.evidence.find(e=>e.field==='top_price').kind,'unknown','Unknown leader data must replace stale manually supplied price');
 }
 const changing=await fixture('changed-package',{changeCanonical:true});
 assert.equal(await consumeOfficialValidation(test.pool,transport,changing.context),'stale','Package evidence changed during sales reads must invalidate the pending decision');
 assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[changing.context.candidateId])).rows[0].stage,'api_validation');
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM evaluations WHERE candidate_id=$1',[changing.context.candidateId])).rows[0].n,0);
 assert.equal(await consumeOfficialValidation(test.pool,transport,changing.context),'reject','Retry must use the newly confirmed package evidence');
 const staleAutomatic=await fixture('automatic-stale',{automatic:true,changeCanonical:true});
 assert.equal(await consumeOfficialValidation(test.pool,transport,staleAutomatic.context),'stale');
 assert.equal((await test.call('/api/candidates/'+staleAutomatic.context.candidateId+'/representative')).body.selectedAsin,null,'A stale market callback cannot select a representative');
 const rollback=await fixture('rollback',{automatic:true});
 await test.pool.query("CREATE FUNCTION qa_market_leader_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_EVALUATION_FAILURE'; END $$");
 await test.pool.query('CREATE TRIGGER qa_market_leader_fail BEFORE INSERT ON evaluations FOR EACH ROW EXECUTE FUNCTION qa_market_leader_fail()');
 try{await assert.rejects(consumeOfficialValidation(test.pool,transport,rollback.context),/SYNTHETIC_EVALUATION_FAILURE/);}
 finally{await test.pool.query('DROP TRIGGER qa_market_leader_fail ON evaluations');await test.pool.query('DROP FUNCTION qa_market_leader_fail()');}
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM evidence WHERE candidate_id=$1 AND field LIKE 'api_market_leader_%'",[rollback.context.candidateId])).rows[0].n,0);
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM evidence WHERE candidate_id=$1 AND field='top_price'",[rollback.context.candidateId])).rows[0].n,1,'Price and assessment roll back together');
 assert.equal((await test.call('/api/candidates/'+rollback.context.candidateId+'/representative')).body.selectedAsin,null,'Failed evaluation must roll back automatic selection');
 assert.equal((await test.pool.query("SELECT count(*)::int n FROM audit_events WHERE target=$1 AND action='representative_asin_auto_selected'",[rollback.context.candidateId])).rows[0].n,0);
 const beforeRetry=calls.length;assert.equal(await consumeOfficialValidation(test.pool,transport,rollback.context),'hold');assert.equal(calls.length,beforeRetry,'Retry uses retained source caches');
 console.log(JSON.stringify({scenario:'market-leader-flow',result:'PASS',fullQuery:true,sharedPeriod:true,parentSalesOnce:true,secondPageLeader:true,unknownReplacesOldPrice:true,atomicAssessment:true,cachedRecovery:true,externalCalls:0}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await test.close();}
