import {automaticSpecUiFixture} from './automatic-spec-ui-fixture.mjs';
import {groundedProposalFixture} from './grounded-proposal-fixture.mjs';
import {searchExportUiFixture} from './search-export-ui-fixture.mjs';
import {consumeOfficialValidation} from '../../apps/worker/src/api-validation.ts';
import {auxiliaryFixture} from './auxiliary-fixture.mjs';
import {queueAmazonSearch} from '../../apps/worker/src/browser-task-producer.ts';
import {assessMarketConcentration,marketRevenueRows,measured,unknown} from '../../packages/domain/src/index.ts';
import {createOrderFixture} from './order-fixture.mjs';
import {standaloneMarketObservations} from './order-market-fixture.mjs';
import assert from 'node:assert/strict';
import {createServer as reservePort} from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from '../../apps/web/node_modules/vite/dist/node/index.js';
import {openAcceptance,otp} from './acceptance.mjs';
import {browserSigningFixture} from './browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../../apps/worker/src/browser-signing-key.ts';
import {deviceVault} from '../../apps/browser-bridge/device-vault.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const reservation=reservePort();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const webOrigin='http://127.0.0.1:'+port;
const test=await openAcceptance({databaseKey:'bridge-ui-'+Date.now(),webOrigin});
const directory=await mkdtemp(path.join(tmpdir(),'forge-bridge-ui-'));
const configFile=path.join(directory,'config.json');
const subject=process.argv.includes('--automatic-spec')?await automaticSpecUiFixture(test):{};
if(process.argv.includes('--grounded-proposal'))Object.assign(subject,await groundedProposalFixture(test,{webOrigin}));
if(process.argv.includes('--grounded-source')){
 const saved=await test.call('/api/custom-ai',{version:0,name:'합성 차별화 분석 연결',model:'synthetic-grounded-model',baseUrl:'https://grounded.fixture.invalid/v1',apiKey:'SYNTHETIC_UI_GROUNDED_KEY',dailyBudgetUsd:'2.00',roles:['niche_analysis','sourcing_analysis'],priority:1,inputUsdPerMillion:'1',outputUsdPerMillion:'2',maxInputTokens:4096,maxOutputTokens:2048});
 assert.equal(saved.status,201);subject.entryPath='/settings/ai';subject.profileId=saved.body.profile.id;
}
let marketPage=null,marketCandidateId=null;
if(process.argv.includes('--order-market')){
 const candidate=await createOrderFixture(test,'market review');
 subject.entryPath='/candidates/'+candidate.id+'/orders';marketCandidateId=candidate.id;
 marketPage=(await test.pool.query("SELECT payload->'firstPageSales' AS page FROM evaluations WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[candidate.id])).rows[0].page;
}
if(process.argv.includes('--catalog')){
 const setting=(await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'catalog-ui-fixture',snapshot || '{\"jsDailyWireCap\":100}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1 RETURNING version,snapshot")).rows[0];
 const keyword='합성 카탈로그 치수 검증';
 const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",[keyword])).rows[0];
 const physical={length_value:3.5,width_value:7.9,height_value:9.2,dimensions_unit:'inches',weight_value:2.2906,weight_unit:'pounds'};
 const data=[[1,physical],[2,{}],[3,{...physical,weight_value:1}],[3,{...physical,weight_value:2}]].map(([i,values])=>({id:'us/B0CA'+String(i).padStart(6,'0'),type:'product_database_result',attributes:{price:25,reviews:100,category:'Kitchen & Dining',parent_asin:null,is_variant:false,is_parent:false,is_standalone:true,variants:[],approximate_30_day_units_sold:400,approximate_30_day_revenue:10000,updated_at:new Date().toISOString(),...values}}));
 if(process.argv.includes('--leader-price-conflict'))data.at(-1).attributes.price=26;
 const transport={kind:'ready',send:async input=>{
  const url=new URL(input.path,'http://127.0.0.1');
  const body=url.pathname==='/api/product_database_query'?{data,links:{next:null}}:auxiliaryFixture(url,input.body);
  if(url.pathname==='/api/sales_estimates_query')for(const day of body.data[0].attributes.data)day.estimated_units_sold=process.argv.includes('--leader-tie')?20:Number(url.searchParams.get('asin').slice(-6))*10;
  return {status:200,retryAfter:null,body};
 }};
 assert.equal(await consumeOfficialValidation(test.pool,transport,{candidateId:candidate.id,keyword,inputVersion:1,settingsVersion:setting.version,snapshot:setting.snapshot,accountScope:'catalog-ui'}),'hold');
 subject.entryPath='/candidates/'+candidate.id;
}
if(process.argv.includes('--market-risk')&&subject.entryPath){
 const id=subject.entryPath.split('/').at(-1);
 marketCandidateId=id;
 const settings=(await test.pool.query('SELECT snapshot FROM settings_versions ORDER BY version DESC LIMIT 1')).rows[0].snapshot;
 const period={startDate:'2026-08-10',endDate:'2026-09-08'};
 const amounts=process.argv.includes('--market-pass')?Array(9).fill(50000):[18000,18000];
 const marketAsins=amounts.map((_,index)=>'B0MR'+String(index).padStart(6,'0'));
 const keys=browserSigningFixture(),identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const pairing=await test.call('/api/bridge/pairings',{}),enrolled=await test.call('/api/bridge/pair',{pairingCode:pairing.body.pairingCode,name:'Synthetic market display'});
 assert.equal(enrolled.status,201);
 const deviceCall=(url,body)=>test.call(url,body,{authorization:'Bearer '+enrolled.body.credential});
 assert.equal((await deviceCall('/api/bridge/capabilities',{connected:true,supportedTasks:['amazon_search'],keyFingerprint:identity.fingerprint})).status,200);
 const queued=await queueAmazonSearch(test.pool,{deviceId:enrolled.body.id,candidateId:id},{origin:webOrigin,privateKey:keys.privateKey});assert.equal(queued.kind,'queued');
 const claim=(await deviceCall('/api/bridge/tasks/claim',{})).body;assert.equal(claim.taskId,queued.taskId);
 const at=new Date().toISOString();
 const query=(await test.pool.query('SELECT normalized_keyword FROM candidates WHERE id=$1',[id])).rows[0].normalized_keyword;
 const observation={protocol:1,kind:'captured',scope:'amazon_search_first_page',query,marketplace:'us',sort:'featured',sourcePageUrl:'https://www.amazon.com/s?k='+encodeURIComponent(query),observedAt:at,rangeText:`1-${marketAsins.length} of 20 results for "${query}"`,rangeEnd:marketAsins.length,coverage:'complete',snapshot:'Synthetic market display',slots:marketAsins.map((asin,index)=>({position:index+1,asin,title:'Synthetic product '+index,productUrl:'https://www.amazon.com/dp/'+asin,imageUrl:null,adStatus:'not_marked',priceTexts:['$30.00'],sourceText:'Synthetic product '+index+' $30.00'}))};
 const accepted=await deviceCall('/api/bridge/tasks/'+claim.taskId+'/results',{taskHash:claim.taskHash,observation});assert.equal(accepted.status,201);
 const receiptId=accepted.body.receiptId,sourceId='browser-task-result:'+receiptId;
 const rows=marketAsins.map((asin,index)=>({asin:measured(asin,sourceId,at),family:measured(asin,sourceId,at),revenue:process.argv.includes('--market-unknown')&&index===0?unknown('SALES_PERIOD_INCOMPLETE',sourceId):measured(amounts[index],sourceId,at)}));
 const concentration=assessMarketConcentration({rows,expectedAsins:marketAsins,period,sourceId,observedAt:at},settings);
 const {shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}=settings;
 const page={marketReceiptId:receiptId,marketAsins,period,observations:standaloneMarketObservations(rows),concentration,criteria:{shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}};
 marketPage=page;
 await test.pool.query("UPDATE evaluations SET payload=jsonb_set(payload,'{firstPageSales}',$2::jsonb),stale=$3 WHERE candidate_id=$1 AND kind='api_validation'",[id,JSON.stringify(page),process.argv.includes('--market-stale')]);
}
if(process.argv.includes('--capabilities')){
 const signing=await publishBrowserSigningIdentity(test.pool,browserSigningFixture().privateKey);
 for(const [name,supportedTasks] of [['합성 검색 전용 PC',['supplier_search']],['합성 상세 전용 PC',['supplier_detail']],['합성 검색·상세 PC',['supplier_search','supplier_detail']],['합성 포장 정보 PC',['amazon_package']],['합성 전체 읽기 PC',['supplier_search','supplier_detail','amazon_package']]]){
  const pairing=await test.call('/api/bridge/pairings',{});assert.equal(pairing.status,201);
  const device=await test.app.inject({method:'POST',url:'/api/bridge/pair',headers:{origin:webOrigin},payload:{pairingCode:pairing.body.pairingCode,name}});assert.equal(device.statusCode,201);
  const report=await test.app.inject({method:'POST',url:'/api/bridge/capabilities',headers:{origin:webOrigin,authorization:'Bearer '+device.json().credential},payload:{connected:true,supportedTasks,keyFingerprint:signing.fingerprint}});assert.equal(report.statusCode,200);
 }
}
const cookies=new Map();
const auth=async(url,payload)=>{
 const response=await test.app.inject({method:'POST',url,headers:{origin:webOrigin,cookie:[...cookies.values()].map(value=>value.split(';')[0]).join('; ')},payload});
 const headers=response.headers['set-cookie'];for(const header of typeof headers==='string'?[headers]:headers??[])cookies.set(header.slice(0,header.indexOf('=')),header);
 assert.equal(response.statusCode,200);return response.json();
};
assert.equal((await auth('/api/auth/sign-in/email',{email:test.authFixture.email,password:test.authFixture.password})).twoFactorRedirect,true);
await auth('/api/auth/two-factor/verify-totp',{code:otp(test.authFixture.totpSecret)});
let vite,searchRuntime,failing=false,closing=false;
const close=async()=>{
 if(closing)return;closing=true;
 await searchRuntime?.close();
 try{
  for(const device of (await test.pool.query('SELECT id FROM bridge_devices')).rows){const credential=await deviceVault('read',{origin:webOrigin,deviceId:device.id});if(credential)await deviceVault('remove',{origin:webOrigin,deviceId:device.id,credential});}
 }finally{
  await vite?.close();await test.close();
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('forge-bridge-ui-'));
  await rm(directory,{recursive:true,force:true});
 }
};
const apiOrigin=await test.app.listen({host:'127.0.0.1',port:0});
vite=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),
 server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':{target:apiOrigin,changeOrigin:false}}},
 plugins:[{name:'isolated-bridge-ui-fixture',configureServer(server){server.middlewares.use((request,response,next)=>{
  if(request.url==='/__qa/session'){
   response.setHeader('set-cookie',[...cookies.values()]);response.statusCode=303;response.setHeader('location',subject.entryPath??'/settings/connections');response.end();return;
  }
  if(failing&&request.url?.startsWith('/api/bridge')){response.statusCode=503;response.setHeader('content-type','application/json');response.end(JSON.stringify({code:'SYNTHETIC_UNAVAILABLE'}));return;}
  if(request.url!=='/__qa/state'||request.method!=='POST'){next();return;}
  void(async()=>{
   let body='';for await(const chunk of request){body+=chunk;if(body.length>1024)throw new Error('Fixture input too large');}
   const {state}=JSON.parse(body);
   switch(state){
    case 'market-unknown':case 'market-stale':case 'market-current':case 'market-caution':case 'market-missing':{
     assert.ok(marketPage&&marketCandidateId);
     let observations=marketPage.observations,concentration=marketPage.concentration;
     if(state==='market-caution'||state==='market-unknown'){
      const sourceId='browser-task-result:'+marketPage.marketReceiptId,at=observations[0].asin.observedAt;
      observations=observations.map((row,index)=>({...row,approximate30DayRevenue:state==='market-unknown'?unknown('SALES_PERIOD_INCOMPLETE',sourceId):measured(index===0?350000:50000,sourceId,at)}));
      concentration=assessMarketConcentration({rows:marketRevenueRows(observations),expectedAsins:marketPage.marketAsins,period:marketPage.period,sourceId,observedAt:at},marketPage.criteria);
     }
     await test.pool.query("UPDATE evaluations SET payload=CASE WHEN $4 THEN payload-'firstPageSales' ELSE jsonb_set(payload,'{firstPageSales}',$2::jsonb) END,stale=$3 WHERE candidate_id=$1 AND kind='api_validation'",[marketCandidateId,JSON.stringify({...marketPage,observations,concentration}),state==='market-stale',state==='market-missing']);break;
    }
    case 'fresh':await test.pool.query("UPDATE bridge_devices SET reported_at=now() WHERE revoked_at IS NULL");break;
    case 'key':await publishBrowserSigningIdentity(test.pool,browserSigningFixture().privateKey);break;
    case 'offline':await test.pool.query("UPDATE bridge_devices SET reported_connected=false,reported_at=now() WHERE revoked_at IS NULL");break;
    case 'unsupported':await test.pool.query("UPDATE bridge_devices SET reported_connected=true,reported_tasks='{}',reported_at=now(),reported_key_fingerprint=(SELECT fingerprint FROM browser_signing_identity WHERE singleton=1) WHERE revoked_at IS NULL");break;
    case 'key-mismatch':await test.pool.query("UPDATE bridge_devices SET reported_key_fingerprint=repeat('0',64),reported_at=now() WHERE revoked_at IS NULL");break;
    case 'long-name':await test.pool.query("UPDATE bridge_devices SET name=$1 WHERE revoked_at IS NULL",['ASIDE-'+ 'W'.repeat(70)]);break;
    case 'normal-name':await test.pool.query("UPDATE bridge_devices SET name='ASIDE 검증 PC' WHERE revoked_at IS NULL");break;
    case 'stale':await test.pool.query("UPDATE bridge_devices SET reported_at=now()-interval '91 seconds' WHERE revoked_at IS NULL");break;
    case 'expire-code':await test.pool.query("UPDATE bridge_pairings SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL AND cancelled_at IS NULL");break;
    case 'error':failing=true;break;
    case 'recover':failing=false;break;
    case 'stop':break;
    default:throw new Error('Unknown fixture state');
   }
   response.setHeader('content-type','application/json');response.end(JSON.stringify({ok:true,state}));
   if(state==='stop'){await close();process.exit(0);}
  })().catch(()=>{response.statusCode=500;response.end('Fixture action failed');});
 });}}],
});
await vite.listen();
if(process.argv.includes('--search-export')||process.argv.includes('--market')){
 try{searchRuntime=await searchExportUiFixture(test,webOrigin,directory,process.argv.includes('--market')?'market':'search-export');subject.entryPath=searchRuntime.entryPath;subject.searchId=searchRuntime.searchId;subject.candidateId=searchRuntime.candidateId;}
 catch(error){await close();throw error;}
}
console.log(JSON.stringify({ready:true,webOrigin,configFile,directory,database:test.database,syntheticSessionBootstrap:true,...subject}));
process.once('SIGINT',()=>{void close().then(()=>process.exit(0));});
process.once('SIGTERM',()=>{void close().then(()=>process.exit(0));});
