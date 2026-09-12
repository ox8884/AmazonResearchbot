import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {amazonMarketObservationSchema,observedListingPrice} from '../packages/domain/src/amazon-market.ts';
import {parseAmazonMarketSource} from '../packages/integrations/src/amazon/market-source.ts';
import {amazonMarketScript} from '../apps/browser-bridge/aside-market-script.mjs';

const source={sourceId:'synthetic-market-source',observedAt:'2026-09-09T00:00:00.000Z'};
for(const prices of [[],['$8.99','$7.99'],['€8.99'],['$0.00'],['< $10'],['$12.345']])assert.equal(observedListingPrice(prices,source).kind,'unknown');
assert.equal(observedListingPrice(['$8.99','$8.99'],source).value,'8.99');
assert.equal(observedListingPrice(['$1,299.00'],source).value,'1299.00');
const slot={position:1,asin:'B0QA000001',title:'Synthetic spatula',productUrl:'https://www.amazon.com/dp/B0QA000001',imageUrl:null,adStatus:'not_marked',priceTexts:['$8.99'],sourceText:'Synthetic spatula $8.99'};
const captured={protocol:1,kind:'captured',scope:'amazon_search_first_page',query:'synthetic spatula',marketplace:'us',sort:'featured',sourcePageUrl:'https://www.amazon.com/s?k=synthetic+spatula',observedAt:source.observedAt,rangeText:'1-1 of 20 results for "synthetic spatula"',rangeEnd:1,coverage:'complete',slots:[slot],snapshot:'Synthetic first-page fixture'};
assert.ok(parseAmazonMarketSource(captured,captured.query));
assert.ok(parseAmazonMarketSource({...captured,sourcePageUrl:'https://www.amazon.com/s/ref=nb_sb_noss?url=search-alias%3Daps&field-keywords=synthetic+spatula'},captured.query));
for(const patch of [
 {sourcePageUrl:'https://www.amazon.com/s?k=other'},
 {sourcePageUrl:captured.sourcePageUrl+'&k=synthetic+spatula'},
 {sourcePageUrl:captured.sourcePageUrl+'&page=2'},
 {sourcePageUrl:captured.sourcePageUrl+'&rh=p_foo'},
 {sourcePageUrl:captured.sourcePageUrl+'&i=kitchen'},
 {sourcePageUrl:captured.sourcePageUrl+'&s=price-asc-rank'},
 {sourcePageUrl:'https://www.amazon.com.evil.test/s?k=synthetic+spatula'},
 {slots:[{...slot,position:2}]},{slots:[{...slot,productUrl:'https://www.amazon.com/dp/B0QA000002'}]},
 {slots:[{...slot,asin:null,productUrl:'https://www.amazon.com/dp/null'}],coverage:'partial'},
 {slots:[{...slot,priceTexts:['$99.00']}]},{coverage:'partial'},
])assert.equal(parseAmazonMarketSource({...captured,...patch},captured.query),null);
const duplicate={...captured,slots:[{...slot,adStatus:'sponsored'}, {...slot,position:2}]};
assert.ok(amazonMarketObservationSchema.safeParse(duplicate).success,'Preserve sponsored and unmarked occurrences of the same ASIN');
async function visiblePriceCapture(){
 const rows=[],title='Synthetic coupon spatula';let value='';
 const prices=[['$17.99',true],['$16.55',true],['$1.44',false]].map(([text,visible])=>({textContent:text,closest:()=>({getClientRects:()=>visible?[{}]:[]})}));
 const card={getClientRects:()=>[{}],getAttribute:()=>slot.asin,innerText:title+'\nPrice, product page\n$17.99\nCoupon price\n$16.55',
  querySelector:selector=>selector==='img.s-image'?{alt:title,src:'https://m.media-amazon.com/images/I/synthetic.jpg'}:selector==='.s-title-instructions-style a'?{innerText:'SponsoredSponsored',href:'#sponsor-info'}:{innerText:title,href:slot.productUrl},querySelectorAll:()=>prices};
 const hidden={...card,getClientRects:()=>[],innerText:'Hidden template with script text'};
 const root={querySelectorAll:()=>[hidden,card]};
 const page={getByRole:(role)=>role==='searchbox'?{fill:async next=>{value=next;},evaluate:async callback=>callback({value})}:role==='button'?{click:async()=>{}}:{evaluate:async callback=>callback({value:'relevanceblender'})},
  locator:selector=>selector==='.s-main-slot'?{waitFor:async()=>{},evaluate:async callback=>callback(root)}:{evaluateAll:async callback=>callback([{innerText:'1-1 of 1 results for "synthetic spatula"',querySelector:()=>null}])},
  evaluate:async()=>captured.sourcePageUrl};
 const context={console:{log:line=>rows.push(line)},getComputedStyle:()=>({visibility:'visible'}),snapshot:async()=>({tree:'Synthetic coupon fixture'}),openTab:async()=>page,closeTab:async()=>{}};
 await vm.runInNewContext('(async()=>{'+amazonMarketScript('synthetic spatula','PRICE:')+'})()',context);
 assert.equal(rows.length,1);return JSON.parse(rows[0].slice('PRICE:'.length));
}
const visible=await visiblePriceCapture();assert.equal(visible.kind,'captured');
assert.equal(visible.slots.length,1,'Hidden result templates are not displayed slots');
assert.equal(visible.slots[0].title,'Synthetic coupon spatula','Sponsored-info links are not product titles');
assert.deepEqual(visible.slots[0].priceTexts,['$17.99','$16.55'],'Hidden savings amount is not an observed offer price');
assert.equal(observedListingPrice(visible.slots[0].priceTexts,source).kind,'unknown','A visible coupon does not silently replace the regular price');
const incomplete={...captured,coverage:'partial',slots:[{...slot,adStatus:'unknown'}]};assert.ok(parseAmazonMarketSource(incomplete,captured.query));
let closed=false,filled=null;const output=[];
const page={getByRole:()=>({fill:async query=>{filled=query;},click:async()=>{throw Error('Controlled failure');}})};
const context={console:{log:value=>output.push(value)},snapshot:async()=>({tree:'search'}),openTab:async()=>page,closeTab:async target=>{assert.equal(target,page);closed=true;}};
const query="x');globalThis.injected=true;//";
await vm.runInNewContext('(async()=>{'+amazonMarketScript(query,'FIXTURE:')+'})()',context);
assert.equal(filled,query);assert.equal(context.injected,undefined);assert.equal(closed,true);assert.equal(output.length,1);
assert.equal(JSON.parse(output[0].slice('FIXTURE:'.length)).kind,'unavailable');
await assert.rejects(vm.runInNewContext('(async()=>{'+amazonMarketScript(query,'FIXTURE:')+'})()',{...context,closeTab:async()=>{throw Error('close failed');},console:{log(){throw Error('Should not emit before cleanup');}}}),/close failed/);
console.log(JSON.stringify({scenario:'amazon-market',result:'PASS',ambiguousPricesUnknown:true,scopeBound:true,duplicateOccurrencesPreserved:true,partialCoverageExplicit:true,queryIsData:true,cleanupBeforeEmit:true,externalCalls:0}));
if(process.argv.includes('--live')){
 assert.ok(process.env.FORGE_ASIDE_CLI_PATH&&process.env.FORGE_ASIDE_ACCOUNT);
 const query='silicone spatula set',marker='FORGE_MARKET_'+randomUUID()+':';
 const stdout=await new Promise((resolve,reject)=>{
  const child=spawn(process.env.FORGE_ASIDE_CLI_PATH,['repl','--account',process.env.FORGE_ASIDE_ACCOUNT,'--host','local',amazonMarketScript(query,marker)],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let output='',failed=false;
  const fail=error=>{if(!failed){failed=true;child.kill();reject(error);}};
  const timer=setTimeout(()=>fail(Error('CAPTURE_TIMEOUT')),130000);
  child.on('error',fail);child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4*1024*1024)fail(Error('OUTPUT_LIMIT'));});
  child.on('close',code=>{clearTimeout(timer);if(!failed)code===0?resolve(output):reject(Error('CAPTURE_FAILED'));});
 });
 const lines=stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').split(/\r?\n/).filter(line=>line.startsWith(marker));assert.equal(lines.length,1);
 const raw=JSON.parse(lines[0].slice(marker.length));
 await mkdir('.omo/evidence/market-evidence',{recursive:true});await writeFile('.omo/evidence/market-evidence/live-observation.json',JSON.stringify(raw,null,2));
 assert.equal(raw.kind,'captured',raw.reason);const parsed=parseAmazonMarketSource(raw,query);assert.ok(parsed,'Actual source must satisfy the observation contract');
 const proof={actualBrowser:true,slots:parsed.slots.length,sponsored:parsed.slots.filter(row=>row.adStatus==='sponsored').length,unmarked:parsed.slots.filter(row=>row.adStatus==='not_marked').length,coverage:parsed.coverage,
  unknownPrice:parsed.slots.filter(row=>observedListingPrice(row.priceTexts,{sourceId:'live-observation',observedAt:parsed.observedAt}).kind==='unknown').length,coreTopPriceWritten:false,paidApiCalls:0};
 await writeFile('.omo/evidence/market-evidence/live-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}
