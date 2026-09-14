import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {browserObservationSchema} from '../packages/domain/src/browser-observation.ts';
import {selectBrowserProductLeader} from '../packages/domain/src/product-database-leader.ts';
import {productDatabaseScript} from '../apps/browser-bridge/aside-product-database-script.mjs';
import {keywordScoutScript} from '../apps/browser-bridge/aside-keyword-scout-script.mjs';
import {historicalDataScript} from '../apps/browser-bridge/aside-historical-data-script.mjs';
import {categoryTrendsScript} from '../apps/browser-bridge/aside-category-trends-script.mjs';
import {competitiveIntelligenceScript} from '../apps/browser-bridge/aside-competitive-intelligence-script.mjs';

const {values}=parseArgs({options:{config:{type:'string',default:'data/browser-bridge/client-jay-aside.json'},query:{type:'string',default:'ice cream scoop'}}});
const root=new URL('../',import.meta.url);
const configPath=path.resolve(fileURLToPath(root),values.config);
const configuration=JSON.parse(await readFile(configPath,'utf8'));
assert.equal(process.platform,'win32','The live ASIDE verifier runs on the configured Windows host');
assert.match(configuration.accountId,/^u\d+$/);
assert.ok(path.isAbsolute(configuration.cliPath));
assert.equal(path.basename(configuration.cliPath).toLowerCase(),'aside.exe');
assert.ok((await stat(configuration.cliPath)).isFile());
const query=values.query.trim();
assert.ok(query.length>0&&query.length<=500,'Query must contain 1-500 characters');

const allowedEnvironment=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','HOMEDRIVE','HOMEPATH','TEMP','TMP','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','USERNAME','USERDOMAIN','LANG']);
const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowedEnvironment.has(key.toUpperCase())));
const captures=[
 ['product_database',productDatabaseScript],
 ['keyword_scout',keywordScoutScript],
 ['historical_data',historicalDataScript],
 ['category_trends',categoryTrendsScript],
 ['competitive_intelligence',competitiveIntelligenceScript],
];

async function capture(kind,makeScript,representativeAsin){
 const marker=`FORGE_LIVE_${randomUUID()}:`;
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(configuration.cliPath,['repl','--account',configuration.accountId,'--host','local',makeScript(query,marker,representativeAsin)],{windowsHide:true,shell:false,env:environment,stdio:['ignore','pipe','pipe']});
  const stdout=[],stderr=[];let size=0,settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(Buffer.concat(stdout).toString('utf8'));};
  const timer=setTimeout(()=>{child.kill();finish(new Error(`${kind}: ASIDE timed out`));},150_000);
  child.once('error',finish);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024){child.kill();finish(new Error(`${kind}: ASIDE output exceeded the safe limit`));}else stdout.push(chunk);});
  child.stderr.on('data',chunk=>{if(stderr.reduce((sum,value)=>sum+value.length,0)<64*1024)stderr.push(chunk);});
  child.once('close',code=>code===0?finish():finish(new Error(`${kind}: ASIDE exited ${code}`)));
 });
 const clean=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
 const lines=clean.split(/\r?\n/).filter(line=>line.startsWith(marker));
 assert.equal(lines.length,1,`${kind}: expected one marked response`);
 const raw=JSON.parse(lines[0].slice(marker.length));
 if(raw?.kind==='unavailable')throw new Error(`${kind}: ${raw.reason??'UNAVAILABLE'}`);
 const parsed=browserObservationSchema.safeParse(raw);
 assert.ok(parsed.success,`${kind}: live observation did not match the domain contract`);
 assert.ok('query' in parsed.data&&parsed.data.query===query,`${kind}: captured query changed`);
 return parsed.data;
}

const summary={};
let representativeAsin=null;
for(const [kind,makeScript] of captures){
 const observation=await capture(kind,makeScript,representativeAsin);
 if(kind==='product_database'){
  const leader=selectBrowserProductLeader(observation);
  representativeAsin=leader.kind==='selected'?leader.asin:null;
 }
 if((kind==='historical_data'||kind==='category_trends')&&observation.representativeAsin!==representativeAsin)throw new Error(`${kind}: representative ASIN binding changed`);
 summary[kind]=kind==='product_database'
  ? {records:observation.records.length,totalCount:observation.totalCount??null,coverage:observation.coverage??null}
  : kind==='keyword_scout'
  ? {keywordRecords:observation.keywordRecords?.length??0,metrics:observation.metrics.length}
  : kind==='historical_data'
  ? {series:observation.series.length,dateRange:observation.dateRange}
  : kind==='category_trends'
  ? {products:observation.products?.length??0,dateColumns:observation.dateColumns?.length??0,kitchenDiningConfirmation:observation.kitchenDiningConfirmation}
  : {competitors:observation.competitors.length,totalCount:observation.totalCount??null,coverage:observation.coverage??null,entitlement:observation.entitlement?.status??'available'};
}
console.log(JSON.stringify({scenario:'jungle-scout-live-aside',result:'PASS',query,representativeAsin,...summary,paidApiCalls:0,externalActions:0}));
