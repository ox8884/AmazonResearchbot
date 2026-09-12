export function supplierDetailScript(request,marker) {
 async function detail(request,marker) {
  let p,result;
  try {
   const productBase=url=>{
    if(typeof url!=='string')return null;
    const base=url.split(/[?#]/,1)[0];
    return /^https:\/\/www\.alibaba\.com\/product-detail\/[^/?#\\\s]+\.html$/.test(base)?base:null;
   };
   const expected=productBase(request.productUrl);
   const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
   if(!expected||!validText(request.companyName,300))throw new Error('INVALID_REQUEST');
   p=await openTab(request.productUrl);
   const checkPage=()=>{
    if(productBase(p.url())!==expected)throw new Error('SITE_CHANGED');
   };
   checkPage();
   await p.locator('h1').waitFor({state:'visible',timeout:15000});
   await p.locator('.module_attribute').waitFor({state:'visible',timeout:15000});
   checkPage();
   const productName=await p.locator('h1').evaluate(el=>el.innerText.trim());
   const companies=await p.locator('body').evaluate((body,companyName)=>Array.from(body.querySelectorAll('a'))
    .filter(a=>a.innerText.trim()===companyName)
    .map(a=>({text:a.innerText.trim(),href:a.href,hostname:a.hostname})),request.companyName);
   if(!companies.length||companies.some(link=>!link.hostname||!link.href)||new Set(companies.map(link=>link.hostname)).size!==1)throw new Error('COMPANY_UNAVAILABLE');
   const companyName=companies[0].text,companyUrl=companies[0].href;
   const capture=await p.locator('.module_attribute').evaluate(el=>({
    text:el.innerText.trim(),
    attributes:Array.from(el.querySelectorAll('[data-testid="module-attribute-row"]')).map(row=>({
     label:row.querySelector('[data-testid="module-attribute-name"]')?.innerText.trim()??'',
     value:row.querySelector('[data-testid="module-attribute-value"]')?.innerText.trim()??'',
     excerpt:row.innerText.trim(),
    })),
   }));
   if(!validText(productName,2000)||!validText(companyName,300)||!capture.attributes.length||capture.attributes.length>100||
    !capture.attributes.every(row=>validText(row.label,100)&&validText(row.value,1000)&&validText(row.excerpt,2000)))throw new Error('FIELDS_UNAVAILABLE');
   const pageText=[productName,companyName,capture.text].join('\n');
   if(!validText(capture.text,100000)||!validText(pageText,100000))throw new Error('TEXT_UNAVAILABLE');
   const heading=await snapshot(p,{selector:'h1'});
   const module=await snapshot(p,{selector:'.module_attribute'});
   if(!validText(heading.tree,100000)||!validText(module.tree,100000))throw new Error('SNAPSHOT_UNAVAILABLE');
   const tree=[heading.tree,module.tree].join('\n');
   if(tree.length>100000)throw new Error('SNAPSHOT_TOO_LARGE');
   checkPage();
   result={protocol:1,kind:'captured',scope:'supplier_product_page',sourcePageUrl:p.url(),companyName,companyUrl,productName,observedAt:new Date().toISOString(),snapshot:tree,pageText,attributes:capture.attributes};
  } catch {
   result={protocol:1,kind:'unavailable',reason:'ASIDE_SITE_OR_LAYOUT_UNAVAILABLE'};
  } finally { if(p)await closeTab(p); }
  console.log(marker+JSON.stringify(result));
 }
 return 'await ('+detail.toString()+')('+JSON.stringify(request)+','+JSON.stringify(marker)+')';
}
