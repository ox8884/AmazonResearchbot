import {createAsideRunner} from './aside-cli.mjs';
import {createAsideModelRunner} from './aside-ai.mjs';
import {proposeAlibabaNegotiation} from './aside-negotiation.mjs';
import {alibabaSessionScript,alibabaFinishScript} from './aside-alibaba-script.mjs';
import {statSync} from 'node:fs';
import path from 'node:path';
import {createBrowserTaskVerifier} from './task-verifier.mjs';
import {openBrowserTaskLedger} from './task-ledger.mjs';
import {supplierSearchScript} from './aside-supplier-script.mjs';
import {supplierDetailScript} from './aside-detail-script.mjs';
import {amazonPackageScript} from './aside-package-script.mjs';
import {savedSearchExportScript} from './aside-search-script.mjs';
import {amazonMarketScript} from './aside-market-script.mjs';
import {productDatabaseScript} from './aside-product-database-script.mjs';
import {keywordScoutScript} from './aside-keyword-scout-script.mjs';
import {historicalDataScript} from './aside-historical-data-script.mjs';
import {categoryTrendsScript} from './aside-category-trends-script.mjs';
import {competitiveIntelligenceScript} from './aside-competitive-intelligence-script.mjs';
import {parseAmazonMarketSource} from '../../packages/integrations/src/amazon/market-source.ts';
import {parseVerifiedSearchExport} from '../../packages/integrations/src/jungle-scout/search-export.ts';
import {browserObservationSchema} from '../../packages/domain/src/browser-observation.ts';
import {alibabaCompanyKey,alibabaProductKey} from '../../packages/integrations/src/sourcing/identity.ts';

export function createAsideAdapter(configuration,runAside,runModel) {
 if(process.platform!=='win32'||typeof configuration.cliPath!=='string'||!path.isAbsolute(configuration.cliPath)||path.basename(configuration.cliPath).toLowerCase()!=='aside.exe'||!statSync(configuration.cliPath).isFile()||!/^u\d+$/.test(configuration.accountId))throw new Error('INVALID_ASIDE_CONFIGURATION');
 const cliPath=configuration.cliPath,accountId=configuration.accountId;
 // FORGE_ALIBABA_SENDS_PAUSED=1 keeps reading supplier replies but never sends: the server only queues and authorizes sends for devices advertising supplier_send.
 const sendsPaused=process.env.FORGE_ALIBABA_SENDS_PAUSED==='1';
 const verifyTask=createBrowserTaskVerifier(configuration),ledger=openBrowserTaskLedger(configuration);
 const invoke=runAside??createAsideRunner({cliPath,accountId});
 const generate=runModel??createAsideModelRunner({cliPath,accountId});
 function validateAlibaba(value,request){
  const parsed=browserObservationSchema.safeParse(value);
  if(!parsed.success||parsed.data.scope!=='alibaba_thread')throw new Error('ASIDE_CAPTURE_INVALID');
  const observation=parsed.data;
  if(observation.conversationId!==request.conversationId||alibabaCompanyKey(observation.companyUrl)!==alibabaCompanyKey(request.companyUrl)||
   alibabaProductKey(observation.productUrl)!==alibabaProductKey(request.productUrl)||(request.threadId!==null&&observation.threadId!==request.threadId)||
   observation.actionId!==(request.kind==='supplier_send'?request.actionId:null)||
   (request.accountId!==null&&observation.accountId!==request.accountId)||
   !/^\d+-\d+#11011@icbu$/.test(observation.threadId)||observation.threadId.split('-')[1]?.split('#')[0]!==observation.accountId||
   (request.kind==='supplier_send'&&observation.sendStatus==='sent'&&!observation.messages.some(message=>message.direction==='outbound'&&message.body===request.body)))throw new Error('ASIDE_CAPTURE_INVALID');
  return observation;
 }
 async function probe(){
  try{
   const result=await invoke(marker=>'console.log('+JSON.stringify(marker)+'+JSON.stringify({protocol:1,connected:Array.isArray(await listBrowserTabs())&&typeof openTab==="function"&&typeof snapshot==="function"}))');
   return {browser:'aside',connected:result.connected===true,supportedTasks:result.connected===true?['supplier_search','supplier_detail','supplier_thread','supplier_send','amazon_package','saved_search_export','amazon_search','product_database','keyword_scout','historical_data','category_trends','competitive_intelligence'].filter(kind=>!(sendsPaused&&kind==='supplier_send')):[]};
  }catch{return {browser:'aside',connected:false,supportedTasks:[]};}
 }
 async function collect(envelope){
  const signed=verifyTask(envelope,{allowExpired:true});
  if(signed.request.kind==='supplier_send'){const prior=ledger.existing(envelope);if(prior)return prior;}
  const task=verifyTask(envelope);
  if(task.request.kind==='supplier_search'&&!task.request.query.trim())throw new Error('INVALID_SEARCH_QUERY');
  if(ledger.inspect(task.id))return ledger.claim(envelope);
  if(!(await probe()).connected)return {kind:'unavailable',taskId:task.id};
 if(sendsPaused&&task.request.kind==='supplier_send')return {kind:'unavailable',taskId:task.id};
  const claim=ledger.claim(envelope);
  if(claim.kind!=='claimed')return claim;
  try{
   if(['supplier_thread','supplier_send'].includes(task.request.kind)){
    const result=await invoke(marker=>alibabaSessionScript(task.request,marker),{
     onReady:async({observation})=>{
      validateAlibaba(observation,task.request);
      if(observation.sendStatus!=='not_sent')throw new Error('ASIDE_CAPTURE_INVALID');
      verifyTask(envelope);
      if(task.request.kind!=='supplier_send'||typeof configuration.beginDispatch!=='function')return {allowed:false,reason:'ALIBABA_DISPATCH_UNAVAILABLE'};
      ledger.beginWrite(claim);
      const authorization=await configuration.beginDispatch({taskId:claim.taskId,taskHash:claim.taskHash});
      if(authorization?.allowed===true)return {allowed:true};
      return {allowed:false,reason:typeof authorization?.reason==='string'&&/^[A-Z0-9_]+$/.test(authorization.reason)?authorization.reason:'ALIBABA_DISPATCH_REJECTED'};
     },finishScript:alibabaFinishScript,
    });
    if(result?.kind==='unavailable')return {kind:'pending_reconciliation',taskId:claim.taskId,taskHash:claim.taskHash,reason:/^[A-Z0-9_]+$/.test(result.reason)?result.reason:'ALIBABA_SITE_UNAVAILABLE'};
    const observation=validateAlibaba(result,task.request);
    if(task.request.kind==='supplier_thread'){
     const proposal=await proposeAlibabaNegotiation(task,observation,generate);
     if(proposal)observation.proposal=proposal;
    }
    return {kind:'captured',taskId:claim.taskId,taskHash:claim.taskHash,observation};
   }
   const result=await invoke(marker=>task.request.kind==='competitive_intelligence'?competitiveIntelligenceScript(task.request.query,marker):task.request.kind==='category_trends'?categoryTrendsScript(task.request.query,marker,task.request.representativeAsin):task.request.kind==='historical_data'?historicalDataScript(task.request.query,marker,task.request.representativeAsin):task.request.kind==='keyword_scout'?keywordScoutScript(task.request.query,marker):task.request.kind==='product_database'?productDatabaseScript(task.request.query,marker,task.request.asins??null):task.request.kind==='amazon_search'?amazonMarketScript(task.request.query,marker):task.request.kind==='saved_search_export'?savedSearchExportScript(task.request,marker):task.request.kind==='amazon_package'?amazonPackageScript(task.request.asin,marker):task.request.kind==='supplier_search'
    ?supplierSearchScript(task.request.query,marker):supplierDetailScript(task.request,marker));
   if(result?.kind==='unavailable'&&typeof result.reason==='string'&&/^[A-Z0-9_]+$/.test(result.reason)){
    return {kind:'pending_reconciliation',taskId:claim.taskId,taskHash:claim.taskHash,reason:result.reason};
   }
   const parsed=browserObservationSchema.safeParse(result);
   if(!parsed.success)throw new Error('ASIDE_CAPTURE_INVALID');
   const observation=parsed.data;
   if(task.request.kind==='competitive_intelligence'){
    if(observation.scope!=='jungle_scout_competitive_intelligence'||observation.query!==task.request.query)throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='category_trends'){
    if(observation.scope!=='jungle_scout_category_trends'||observation.query!==task.request.query||(observation.representativeAsin??null)!==task.request.representativeAsin)throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='historical_data'){
    if(observation.scope!=='jungle_scout_historical_data'||observation.query!==task.request.query||(observation.representativeAsin??null)!==task.request.representativeAsin)throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='keyword_scout'){
    if(observation.scope!=='jungle_scout_keyword_scout'||observation.query!==task.request.query)throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='product_database'){
    if(observation.scope!=='jungle_scout_product_database'||observation.query!==task.request.query)throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='amazon_search'){
    if(!parseAmazonMarketSource(observation,task.request.query))throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='saved_search_export'){
    if(!await parseVerifiedSearchExport(observation,task.request))throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='amazon_package'){
    if(observation.scope!=='amazon_product_page'||observation.asin!==task.request.asin)throw new Error('ASIDE_CAPTURE_INVALID');
   }else if(task.request.kind==='supplier_search'){
    if(observation.scope!=='first_results_page'||observation.query!==task.request.query)throw new Error('ASIDE_CAPTURE_INVALID');
   }else{
    if(observation.scope!=='supplier_product_page'||observation.companyName!==task.request.companyName||
      alibabaCompanyKey(observation.companyUrl)!==alibabaCompanyKey(task.request.companyUrl)||
      alibabaProductKey(observation.sourcePageUrl)!==alibabaProductKey(task.request.productUrl))throw new Error('ASIDE_CAPTURE_INVALID');
   }
   return {kind:'captured',taskId:claim.taskId,taskHash:claim.taskHash,observation};
  }catch(error){
   const reason=error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:'ASIDE_EXECUTION_UNCONFIRMED';
   return {kind:'pending_reconciliation',taskId:claim.taskId,taskHash:claim.taskHash,reason};
  }
 }
 return Object.freeze({probe,collect,confirmServerReceipt:ledger.complete,inspect:ledger.inspect,close:ledger.close});
}
