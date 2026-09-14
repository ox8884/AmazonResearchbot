import assert from 'node:assert/strict';
import vm from 'node:vm';
import {keywordScoutScript} from '../apps/browser-bridge/aside-keyword-scout-script.mjs';

async function run({visibleQuery=true}={}){
 const output=[];let filled='';
 const input={waitFor:async()=>{},fill:async value=>{filled=value;},evaluate:async()=>filled};
 const records=[{keyword:'ice cream scoop',searchTrend30Day:'17%',exactSearchVolume30Day:'190,420',category:'Home & Kitchen',ppcBidExact:'$1.10',ppcBidBroad:'$1.01',easeToRank:'Very Difficult',relevancyScore:null,sourceText:'ice cream scoop 17% 190,420 Home & Kitchen $1.10 $1.01 Very Difficult'}];
 const table={
  waitFor:async()=>{},
  evaluate:async()=>records,
 };
 const queryRow={first(){return this;},waitFor:async()=>{if(!visibleQuery)throw Error('timeout');}};
 const page={
  goto:async url=>assert.equal(url,'https://members.junglescout.com/#/keyword'),
  evaluate:async()=> 'https://members.junglescout.com/#/keyword',
  getByText:(name,{exact})=>{assert.equal(name,'ice cream scoop');assert.equal(exact,true);return queryRow;},
  getByRole:(role,options)=>{
   if(role==='textbox')return input;
   if(role==='button'){assert.equal(options.name,'Search');assert.equal(options.exact,true);return {click:async()=>{}};}
   if(role==='table'){assert.equal(options.name,'Keyword Results');assert.equal(options.exact,true);return table;}
   throw Error('unexpected role');
  },
 };
 await vm.runInNewContext('(async()=>{'+keywordScoutScript('ice cream scoop','KEYWORD:')+'})()',{
  console:{log:value=>output.push(value)},listBrowserTabs:async()=>[{targetId:'js',url:'https://members.junglescout.com/#/database'}],
  attachBrowserTab:async()=>page,openTab:async()=>{throw Error('must reuse authenticated tab');},closeTab:async()=>{throw Error('must preserve user tab');},
  snapshot:async()=>({tree:'Keyword Results ice cream scoop 17% 190,420 Home & Kitchen $1.10 $1.01 Very Difficult'}),
 },{timeout:1000});
 return JSON.parse(output[0].slice('KEYWORD:'.length));
}

const captured=await run();
assert.equal(captured.kind,'captured',JSON.stringify(captured));
assert.equal(captured.keywordRecords[0].exactSearchVolume30Day,'190,420');
assert.equal(captured.metrics.length,0,'Column headers are not row observations');
assert.equal(captured.asinRelations.length,0,'The keyword table does not expose ASIN relations');
assert.equal((await run({visibleQuery:false})).kind,'unavailable','A stale table without the requested keyword cannot be accepted');
console.log(JSON.stringify({scenario:'aside-keyword-scout-script',result:'PASS',queryBoundResults:true,structuredRows:true,unknownsPreserved:true,userTabPreserved:true}));
