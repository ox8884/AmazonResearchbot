import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {searchExportObservationSchema} from '../packages/domain/src/search-export.ts';
import {parseVerifiedSearchExport} from '../packages/integrations/src/jungle-scout/search-export.ts';
import {savedSearchExportScript} from '../apps/browser-bridge/aside-search-script.mjs';

const request={kind:'saved_search_export',searchRunId:randomUUID(),searchId:randomUUID(),revision:1,marketplace:'us',category:'Kitchen & Dining',filters:{priceMinUsd:'20',priceMaxUsd:'40',monthlySearchMin:500,competitionMax:'Low',seasonalityMax:'Low'}};
const header='Keyword,Niche Score,Units Sold - Monthly Avg,Price - Monthly Avg,Search Volume - 30 Day Exact,Search Trend - 30 Day,Search Trend - 90 Day,Competition,Seasonality,Last Updated';
const bytes=Buffer.from('JUNGLESCOUT WEBAPP CSV EXPORT\nReport Generated at: synthetic fixture\n'+header+'\n"synthetic tray","8","1,000","$25.00","700","-","-","Low","Low","Sep 08, 2026"\n');
const observation={protocol:1,kind:'captured',scope:'opportunity_finder_export',sourcePageUrl:'https://members.junglescout.com/#/opportunity-finder',observedAt:new Date().toISOString(),searchRunId:request.searchRunId,searchId:request.searchId,revision:1,marketplace:'us',discoveryCategory:'Home & Kitchen',filters:request.filters,
 applied:{lower:['','20','500','','',''],upper:['','40','','','',''],competition:['Very Low','Low'],seasonality:['Very Low','Low']},
 records:[{keyword:'synthetic tray',dominantCategory:'Home & Kitchen'}],totalResults:900,page:1,filename:'Jungle Scout Opportunity Finder CSV Export - synthetic.csv',csvBase64:bytes.toString('base64'),snapshot:'synthetic tray Home & Kitchen'};
assert.equal(searchExportObservationSchema.safeParse(observation).success,true);
const parsed=await parseVerifiedSearchExport(observation,request);assert.ok(parsed);assert.deepEqual(parsed.bytes,bytes);assert.deepEqual(parsed.parsed.mapping,{keyword:'Keyword'});
for(const change of [
 value=>{value.searchRunId=randomUUID();},value=>{value.searchId=randomUUID();},value=>{value.revision=2;},
 value=>{value.filters={...value.filters,priceMinUsd:'21'};},value=>{value.applied.lower[0]='100';},
 value=>{value.applied.competition=['Very Low','Medium'];},value=>{value.marketplace='ca';},
 value=>{value.discoveryCategory='Kitchen & Dining';},value=>{value.sourcePageUrl='https://members.junglescout.com.evil.test/';},
 value=>{value.records[0].keyword='different keyword';value.snapshot='different keyword';},
 value=>{value.csvBase64=Buffer.from('Keyword\nsynthetic tray\n').toString('base64');},
 value=>{value.csvBase64=Buffer.from(bytes.toString().replace('Keyword,Niche Score','Keyword,Changed Score')).toString('base64');},
 value=>{value.page=2;},value=>{value.totalResults=0;},value=>{value.snapshot='missing evidence';},
 value=>{value.filename='../export.csv';},value=>{value.csvBase64+='=';},
 value=>{value.csvBase64=Buffer.from(bytes.toString().replace('"700"','"< 450"')).toString('base64');},
 value=>{value.csvBase64=Buffer.from(bytes.toString().replace('$25.00','$99.00')).toString('base64');},
 value=>{value.csvBase64=Buffer.from(bytes.toString().replace('"Low","Low"','"Medium","Low"')).toString('base64');},
]){const changed=structuredClone(observation);change(changed);assert.equal(await parseVerifiedSearchExport(changed,request),null);}
assert.throws(()=>savedSearchExportScript({...request,filters:{competition:"x');globalThis.injected=true;//"}},'M:'),/SEARCH_FILTER_REQUIRES_MAPPING/);
assert.throws(()=>savedSearchExportScript({...request,filters:{competition:'Low'}},'M:'),/SEARCH_FILTER_REQUIRES_MAPPING/,'Old notes are not structured filter limits');
const outputs=[],events=[],page={evaluate:async()=> 'https://unexpected.invalid/'};
const context={console:{log:value=>outputs.push(value)},openTab:async()=>{events.push('open');return page;},closeTab:async value=>{assert.equal(value,page);await new Promise(resolve=>setTimeout(resolve,5));events.push('closed');}};
await vm.runInNewContext('(async()=>{'+savedSearchExportScript(request,"x');globalThis.injected=true;//")+'})()',context);
assert.deepEqual(events,['open','closed']);assert.equal(outputs.length,1);assert.equal(context.injected,undefined);
const closedFailure={...context,closeTab:async()=>{throw Error('cleanup failed');},console:{log:()=>{throw Error('must not emit after failed cleanup');}}};
await assert.rejects(vm.runInNewContext('(async()=>{'+savedSearchExportScript(request,'M:')+'})()',closedFailure),/cleanup failed/);
if(process.argv.includes('--observed')){
 const live=JSON.parse(await readFile('.omo/evidence/saved-search-export/live-task-observation.json','utf8')).observation;
 assert.ok(await parseVerifiedSearchExport(live,{...request,searchRunId:live.searchRunId,searchId:live.searchId,revision:live.revision,filters:live.filters}));
}
console.log(JSON.stringify({scenario:'search-export-contract',result:'PASS',exactFileAndRows:true,filtersBound:true,scopeAndRunBound:true,untrustedDataNotCode:true,ownedTabCleanup:true,observedFileChecked:process.argv.includes('--observed'),externalCalls:0}));
