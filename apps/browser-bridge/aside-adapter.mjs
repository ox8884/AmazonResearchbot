import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {statSync} from 'node:fs';
import path from 'node:path';
import {createBrowserTaskVerifier} from './task-verifier.mjs';
import {openBrowserTaskLedger} from './task-ledger.mjs';
import {supplierSearchScript} from './aside-supplier-script.mjs';
import {supplierDetailScript} from './aside-detail-script.mjs';
import {amazonPackageScript} from './aside-package-script.mjs';
import {savedSearchExportScript} from './aside-search-script.mjs';
import {amazonMarketScript} from './aside-market-script.mjs';
import {parseAmazonMarketSource} from '../../packages/integrations/src/amazon/market-source.ts';
import {parseVerifiedSearchExport} from '../../packages/integrations/src/jungle-scout/search-export.ts';
import {browserObservationSchema} from '../../packages/domain/src/browser-observation.ts';
import {alibabaCompanyKey,alibabaProductKey} from '../../packages/integrations/src/sourcing/identity.ts';

export function createAsideAdapter(configuration) {
 if(process.platform!=='win32'||typeof configuration.cliPath!=='string'||!path.isAbsolute(configuration.cliPath)||path.basename(configuration.cliPath).toLowerCase()!=='aside.exe'||!statSync(configuration.cliPath).isFile()||!/^u\d+$/.test(configuration.accountId))throw new Error('INVALID_ASIDE_CONFIGURATION');
 const cliPath=configuration.cliPath,accountId=configuration.accountId;
 const verifyTask=createBrowserTaskVerifier(configuration),ledger=openBrowserTaskLedger(configuration);
 const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','HOMEDRIVE','HOMEPATH','TEMP','TMP','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','USERNAME','USERDOMAIN','LANG']);
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toUpperCase())));
 async function invoke(makeScript) {
  const marker='FORGE_ASIDE_'+randomUUID()+':',script=makeScript(marker);
  const output=await new Promise((resolve,reject)=>{
   const child=spawn(cliPath,['repl','--account',accountId,'--host','local',script],{windowsHide:true,shell:false,env,stdio:['ignore','pipe','ignore']});
   const chunks=[];let size=0,failed=false;
   const fail=()=>{if(!failed){failed=true;child.kill();reject(new Error('ASIDE_EXECUTION_UNCONFIRMED'));}};
   const timer=setTimeout(fail,130000);
   child.on('error',fail);
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024)fail();else chunks.push(chunk);});
   child.on('close',code=>{clearTimeout(timer);if(failed)return;if(code!==0){reject(new Error('ASIDE_EXECUTION_UNCONFIRMED'));return;}resolve(Buffer.concat(chunks).toString('utf8'));});
  });
  const clean=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
  const lines=clean.split(/\r?\n/).filter(line=>line.startsWith(marker));
  if(lines.length!==1)throw new Error('ASIDE_RESPONSE_INVALID');
  let result;try{result=JSON.parse(lines[0].slice(marker.length));}catch{throw new Error('ASIDE_RESPONSE_INVALID');}
  if(!result||result.protocol!==1)throw new Error('ASIDE_RESPONSE_INVALID');
  return result;
 }
 async function probe(){
  try{
   const result=await invoke(marker=>'console.log('+JSON.stringify(marker)+'+JSON.stringify({protocol:1,connected:Array.isArray(await listBrowserTabs())&&typeof openTab==="function"&&typeof snapshot==="function"}))');
   return {browser:'aside',connected:result.connected===true,supportedTasks:result.connected===true?['supplier_search','supplier_detail','amazon_package','saved_search_export','amazon_search']:[]};
  }catch{return {browser:'aside',connected:false,supportedTasks:[]};}
 }
 async function collect(envelope){
  const task=verifyTask(envelope);
  if(task.request.kind==='supplier_search'&&!task.request.query.trim())throw new Error('INVALID_SEARCH_QUERY');
  if(ledger.inspect(task.id))return ledger.claim(envelope);
  if(!(await probe()).connected)return {kind:'unavailable',taskId:task.id};
  const claim=ledger.claim(envelope);
  if(claim.kind!=='claimed')return claim;
  try{
   const result=await invoke(marker=>task.request.kind==='amazon_search'?amazonMarketScript(task.request.query,marker):task.request.kind==='saved_search_export'?savedSearchExportScript(task.request,marker):task.request.kind==='amazon_package'?amazonPackageScript(task.request.asin,marker):task.request.kind==='supplier_search'
    ?supplierSearchScript(task.request.query,marker):supplierDetailScript(task.request,marker));
   const parsed=browserObservationSchema.safeParse(result);
   if(!parsed.success)throw new Error('ASIDE_CAPTURE_INVALID');
   const observation=parsed.data;
   if(task.request.kind==='amazon_search'){
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
