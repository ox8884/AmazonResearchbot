import assert from 'node:assert/strict';
import vm from 'node:vm';
import {supplierSearchScript} from '../apps/browser-bridge/aside-supplier-script.mjs';
import {amazonPackageScript} from '../apps/browser-bridge/aside-package-script.mjs';
const query="x'); globalThis.injected=true; //";
let captured,closed=false;
const fakePage={url:()=>'https://www.alibaba.com/',locator:()=>({
 waitFor:async()=>{},
 fill:async value=>{captured=value;},
 evaluate:async()=>captured,
 click:async()=>{throw new Error('Controlled stop after query verification');},
})};
const context={injected:false,console:{log(){}},openTab:async()=>fakePage,closeTab:async()=>{closed=true;},snapshot:async()=>{
 await new Promise(resolve=>setTimeout(resolve,5));
 return {tree:'- textbox "Search Alibaba" [ref=e1]\n- button "검색" [ref=e2]'};
}};
await vm.runInNewContext('(async()=>{'+supplierSearchScript(query,'FIXTURE:')+'})()',context,{timeout:1000});
assert.equal(captured,query);
assert.equal(context.injected,false);
assert.equal(closed,true,'One-shot caller must await work and finally cleanup');
const lateOutputs=[];
await assert.rejects(vm.runInNewContext('(async()=>{'+supplierSearchScript(query,'FIXTURE:')+'})()',{
 ...context,console:{log:value=>lateOutputs.push(value)},closeTab:async()=>{throw new Error('Controlled cleanup failure');},
},{timeout:1000}));
assert.equal(lateOutputs.length,0,'Do not emit success before tab cleanup completes');
console.log(JSON.stringify({scenario:'aside-script',result:'PASS',queryIsData:true,asyncWorkAwaited:true,ownedTabClosed:true}));

const {supplierDetailScript}=await import('../apps/browser-bridge/aside-detail-script.mjs');
const observed={
 sourcePageUrl:'https://www.alibaba.com/product-detail/Synthetic-Test-Tray_1000000000001.html?fixture=true',
 productName:'SYNTHETIC test tray',
 companyLinks:[
  {text:'SYNTHETIC Test Supplier',url:'https://synthetic-seller.m.en.alibaba.com/?productId=1000000000001',hostname:'synthetic-seller.m.en.alibaba.com'},
  {text:'SYNTHETIC Test Supplier',url:'https://synthetic-seller.m.en.alibaba.com/?productId=1000000000001',hostname:'synthetic-seller.m.en.alibaba.com'},
  {text:'Unrelated account',url:'https://accounts.alibaba.com/',hostname:'accounts.alibaba.com'},
 ],
 attributes:[
  {label:'Material',value:'Synthetic steel',excerpt:'Material\nSynthetic steel'},
  {label:'Shipping package size',value:'1X1X1 cm',excerpt:'Shipping package size\n1X1X1 cm'},
 ],
 attributeText:'Main attributes\nMaterial\nSynthetic steel\nPackaging and shipping\nShipping package size\n1X1X1 cm',
};
const detailRequest={productUrl:observed.sourcePageUrl,companyName:observed.companyLinks[0].text};
const unavailable={protocol:1,kind:'unavailable',reason:'ASIDE_SITE_OR_LAYOUT_UNAVAILABLE'};
async function runDetail(options={}) {
 const request=options.request??detailRequest;
 const events=[],outputs=[],scopes=[];
 const layout=structuredClone(observed);
 options.mutate?.(layout);
 let urlReads=0;
 const page={url:()=>++urlReads>1&&options.lateUrl?options.lateUrl:options.url??request.productUrl,locator:selector=>({
  waitFor:async()=>{events.push('wait');if(options.waitFailure)throw new Error('Layout unavailable');},
  evaluate:async (callback,arg)=>{
   const callbackContext={arg};
   if(selector==='h1')callbackContext.el={innerText:layout.productName};
   else if(selector==='body')callbackContext.el={
    get innerText(){throw new Error('Whole body text forbidden');},
    querySelectorAll:selection=>{
     assert.equal(selection,'a');
     return layout.companyLinks.map(link=>({innerText:link.text,href:link.url,hostname:link.hostname}));
    },
   };
   else {
    assert.equal(selector,'.module_attribute');
    callbackContext.el={innerText:layout.attributeText,querySelectorAll:selection=>{
     assert.equal(selection,'[data-testid="module-attribute-row"]');
     return layout.attributes.map(row=>({innerText:row.excerpt,querySelector:field=>{
      assert.ok(['[data-testid="module-attribute-name"]','[data-testid="module-attribute-value"]'].includes(field));
      const value=field.includes('-name')?row.label:row.value;
      return value===null?null:{innerText:value};
     }}));
    }};
   }
   const value=vm.runInNewContext('('+callback.toString()+')(el,arg)',callbackContext,{timeout:1000});
   if(selector==='body')assert.ok(value.every(link=>link.text===request.companyName),'Filter unrelated links inside DOM evaluation');
   return value;
  },
 })};
 const marker=options.marker??'DETAIL:';
 const context={injected:false,console:{log:value=>{events.push('emit');outputs.push(value);}},
  openTab:async url=>{assert.equal(url,request.productUrl);events.push('open');if(options.openFailure)throw new Error('Open failed');return page;},
  closeTab:async owned=>{
   assert.equal(owned,page,'Close only the tab returned by openTab');events.push('closing');
   await new Promise(resolve=>setTimeout(resolve,5));
   if(options.closeFailure)throw new Error('Cleanup failed');events.push('closed');
  },
  snapshot:async (owned,opts)=>{
   assert.equal(owned,page);assert.ok(['h1','.module_attribute'].includes(opts.selector));
   scopes.push(opts.selector);
   await new Promise(resolve=>setTimeout(resolve,5));
   return {tree:options.emptySnapshot?'':'scoped '+opts.selector};
  },
 };
 assert.equal(vm.runInNewContext('typeof URL',context),'undefined','ASIDE REPL has no global URL');
 const script=supplierDetailScript(request,marker);
 assert.ok(script.startsWith('await '),'Execution must be top-level awaited');
 const execution=vm.runInNewContext('(async()=>{'+script+'})()',context,{timeout:1000});
 if(events.includes('open'))assert.equal(outputs.length,0,'No output before awaited work');
 if(options.closeFailure){await assert.rejects(execution,/Cleanup failed/);assert.deepEqual(outputs,[]);}
 else {
  await execution;assert.equal(outputs.length,1);assert.ok(outputs[0].startsWith(marker));
  if(events.includes('open')&&!options.openFailure)assert.ok(events.indexOf('closed')<events.indexOf('emit'));
 }
 assert.equal(context.injected,false);
 assert.equal(events.filter(event=>event==='closing').length,events.includes('open')&&!options.openFailure?1:0);
 return {result:outputs.length?JSON.parse(outputs[0].slice(marker.length)):null,scopes};
}
const detail=await runDetail();
assert.deepEqual(Object.keys(detail.result).sort(),['protocol','kind','scope','sourcePageUrl','companyName','companyUrl','productName','observedAt','snapshot','pageText','attributes'].sort());
assert.equal(detail.result.kind,'captured');
assert.equal(detail.result.protocol,1);
assert.equal(detail.result.scope,'supplier_product_page');
assert.equal(detail.result.sourcePageUrl,detailRequest.productUrl);
assert.equal(detail.result.companyName,detailRequest.companyName);
assert.equal(detail.result.productName,observed.productName);
assert.equal(detail.result.companyUrl,observed.companyLinks[0].url,'Preserve observed mobile company href');
assert.equal(new Date(detail.result.observedAt).toISOString(),detail.result.observedAt);
assert.deepEqual(detail.result.attributes,observed.attributes,'Preserve raw attributes including shipping package size');
assert.equal(detail.result.pageText,[observed.productName,detailRequest.companyName,observed.attributeText].join('\n'));
assert.deepEqual(detail.scopes,['h1','.module_attribute']);
assert.equal(detail.result.snapshot,'scoped h1\nscoped .module_attribute');
const changedQuery=await runDetail({url:detailRequest.productUrl.split('?')[0]+'?other=true'});
assert.equal(changedQuery.result.kind,'captured');
assert.equal(changedQuery.result.sourcePageUrl,detailRequest.productUrl.split('?')[0]+'?other=true');
const hostile="x'); globalThis.injected=true; //\n\"\\";
const injected=await runDetail({request:{productUrl:detailRequest.productUrl+'&data='+hostile,companyName:hostile},marker:hostile,mutate:layout=>{layout.companyLinks=layout.companyLinks.filter(link=>link.text===detailRequest.companyName).map(link=>({...link,text:hostile}));}});
assert.equal(injected.result.kind,'captured');
assert.equal(injected.result.companyName,hostile);
const multiline=await runDetail({mutate:layout=>{layout.attributes[0]={label:' Material ',value:' Steel\n201 ',excerpt:' Material\nSteel\n201 '};}});
assert.deepEqual(multiline.result.attributes[0],{label:'Material',value:'Steel\n201',excerpt:'Material\nSteel\n201'});
for(const options of [
 {url:'https://www.alibaba.com/product-detail/another.html'},
 {url:'http://www.alibaba.com/product-detail/item.html'},
 {url:'https://www.alibaba.com.evil.test/product-detail/item.html'},
 {lateUrl:'https://www.alibaba.com/login'},
 ...[
  'https://www.alibaba.com/login',
  'https://www.alibaba.com/product-detail/item.html/extra',
  'https://www.alibaba.com/product-detail/item',
  'https://www.alibaba.com.evil.test/product-detail/item.html',
  'https://www.alibaba.com@evil.test/product-detail/item.html',
  'http://www.alibaba.com/product-detail/item.html',
 ].map(productUrl=>({request:{...detailRequest,productUrl}})),
 {openFailure:true},{waitFailure:true},{emptySnapshot:true},
 {mutate:layout=>{layout.companyLinks=[];}},
 {mutate:layout=>{layout.companyLinks[1].url='https://different.en.alibaba.com/';layout.companyLinks[1].hostname='different.en.alibaba.com';}},
 {mutate:layout=>{layout.productName=' ';}},
 {mutate:layout=>{layout.attributes=[];}},
 {mutate:layout=>{layout.attributes[0].label=null;}},
 {mutate:layout=>{layout.attributes[0].value=' ';}},
 {mutate:layout=>{layout.attributes[0].excerpt=' ';}},
 {mutate:layout=>{layout.productName='x'.repeat(2001);}},
 {mutate:layout=>{layout.attributes[0].label='x'.repeat(101);}},
 {mutate:layout=>{layout.attributes[0].value='x'.repeat(1001);}},
 {mutate:layout=>{layout.attributes[0].excerpt='x'.repeat(2001);}},
 {mutate:layout=>{layout.attributes=Array(101).fill(layout.attributes[0]);}},
 {mutate:layout=>{layout.attributeText='x'.repeat(100000);}},
 {request:{...detailRequest,companyName:'x'.repeat(301)}},
])assert.deepEqual((await runDetail(options)).result,unavailable);
await runDetail({closeFailure:true});
await runDetail({waitFailure:true,closeFailure:true});
console.log(JSON.stringify({scenario:'aside-detail-script',result:'PASS',requestIsData:true,asyncWorkAwaited:true,ownedTabClosed:true,cleanupFailureSuppressesCapture:true,rawObservedFields:true,scopedSnapshots:true}));

async function runPackage(options={}){
 const asin=options.asin??'B0QA000001',events=[],outputs=[],expanded=new Set();let reads=0;
 const data=options.rows??[['ASIN','B0QA000001'],['Package Dimensions','18 x 14 x 8 inches; 1 pound']];
 const root={querySelectorAll:selector=>{
  assert.equal(selector,'table tr');return data.map(([label,value])=>({
   children:[{tagName:'TH',innerText:label},{tagName:'TD',innerText:value}],innerText:label+'\t'+value,
   getClientRects:()=>expanded.has(label==='ASIN'?'Item details':'Measurements')?[{}]:[],
  }));
 }};
 const page={url:()=>++reads>2&&options.lateUrl?options.lateUrl:options.url??'https://www.amazon.com/dp/'+asin,
  locator:selector=>{
   if(selector==='body')return {evaluate:async callback=>vm.runInNewContext('('+callback.toString()+')(root)',{root:{querySelector:()=>null,querySelectorAll:()=>[]},getComputedStyle:()=>({visibility:'visible'})},{timeout:1000})};
   assert.equal(selector,'#productDetails_feature_div');return {
    waitFor:async()=>{if(options.waitFailure)throw Error('Unavailable');},
    evaluate:async callback=>vm.runInNewContext('('+callback.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})},{timeout:1000}),
   };
  },
  getByRole:(role,{name})=>{
   assert.equal(role,'button');assert.ok(['Item details','Measurements'].includes(name));return {
    waitFor:async()=>{},evaluate:async callback=>callback({getAttribute:()=>expanded.has(name)?'true':'false'}),
    click:async()=>{if(!options.clickIgnored)expanded.add(name);events.push('expand:'+name);},
    press:async key=>{assert.equal(key,'Enter');expanded.add(name);events.push('expand:'+name);},
   };
  },
 };
 const context={injected:false,console:{log:line=>{events.push('emit');outputs.push(line);}},
  openTab:async url=>{assert.equal(url,'https://www.amazon.com/dp/'+asin);events.push('open');return page;},
  closeTab:async owned=>{assert.equal(owned,page);if(options.closeFailure)throw Error('Cleanup failed');events.push('close');},
  snapshot:async(owned,opts)=>{assert.equal(owned,page);assert.equal(opts.selector,'#productDetails_feature_div');assert.notEqual(opts.showHidden,true);return {tree:options.emptySnapshot?'':'Synthetic scoped product information'};},
 };
 const execute=vm.runInNewContext('(async()=>{'+amazonPackageScript(asin,'PACKAGE:')+'})()',context,{timeout:1000});
 if(options.closeFailure){await assert.rejects(execute,/Cleanup failed/);assert.equal(outputs.length,0);return;}
 await execute;assert.equal(outputs.length,1);assert.equal(context.injected,false);
 if(events.includes('open'))assert.ok(events.indexOf('close')<events.indexOf('emit'),'Cleanup precedes capture emission');
 return JSON.parse(outputs[0].slice('PACKAGE:'.length));
}
const packageCapture=await runPackage();assert.equal(packageCapture.scope,'amazon_product_page');assert.equal(packageCapture.rows.length,2);
assert.equal((await runPackage({clickIgnored:true})).kind,'captured','Semantic activation must open the accordion when a fresh-page click does not');
assert.ok(packageCapture.rows.every(row=>packageCapture.pageText.includes(row.excerpt)));
assert.equal((await runPackage({rows:[['ASIN','B0QA000001'],['Item Weight','4.8 ounces']]})).kind,'captured','Missing package facts are observations, not invented measurements');
for(const options of [{asin:"x'); injected=true; //"},{url:'https://www.amazon.com.evil.invalid/dp/B0QA000001'},
 {lateUrl:'https://www.amazon.com/dp/B0QA000002'},{rows:[['ASIN','B0QA000002']]},{waitFailure:true},{emptySnapshot:true}])assert.equal((await runPackage(options)).kind,'unavailable');
await runPackage({closeFailure:true});
console.log(JSON.stringify({scenario:'aside-package-script',result:'PASS',exactAsin:true,visibleRowsOnly:true,scopedSnapshot:true,requestIsData:true,cleanupBeforeEmission:true}));
