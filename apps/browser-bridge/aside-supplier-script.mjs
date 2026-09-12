export function supplierSearchScript(query,marker) {
 async function search(query,marker) {
  let p,result;
  const emit=value=>console.log(marker+JSON.stringify(value));
  try {
   p=await openTab('https://www.alibaba.com/');
   if(!/^https:\/\/www\.alibaba\.com\//.test(p.url()))throw new Error('SITE_CHANGED');
   await snapshot(p,{interactive:true});
   await p.locator('[aria-label="Search Alibaba"]').waitFor({state:'visible',timeout:15000});
   const initial=await snapshot(p,{interactive:true});
   const refs=(tree,pattern)=>Array.from(tree.matchAll(pattern)).map(match=>match[1]);
   const inputs=refs(initial.tree,/- textbox "Search Alibaba" \[ref=((?:f\d+)?e\d+)\]/g);
   if(inputs.length!==1)throw new Error('SEARCH_LAYOUT_CHANGED');
   await p.locator(inputs[0]).fill(query);
   const filled=await snapshot(p,{interactive:true});
   const filledInputs=refs(filled.tree,/- textbox "Search Alibaba" \[ref=((?:f\d+)?e\d+)\]/g);
   const buttons=refs(filled.tree,/- button "(?:검색|Search)" \[ref=((?:f\d+)?e\d+)\]/g);
   if(filledInputs.length!==1||buttons.length!==1)throw new Error('SEARCH_LAYOUT_CHANGED');
   if(await p.locator(filledInputs[0]).evaluate(el=>el.value)!==query)throw new Error('QUERY_NOT_APPLIED');
   await p.locator(buttons[0]).click();
   await snapshot(p,{interactive:true});
   if(!/^https:\/\/www\.alibaba\.com\//.test(p.url()))throw new Error('SITE_CHANGED');
   await p.locator('.fy26-product-card-wrapper').first().waitFor({state:'visible',timeout:20000});
   const final=await snapshot(p,{interactive:true});
   if(await p.locator('[aria-label="Search Alibaba"]').evaluate(el=>el.value)!==query)throw new Error('QUERY_CHANGED');
   const capture=await p.locator('body').evaluate(body=>{
    const cards=Array.from(body.querySelectorAll('.fy26-product-card-wrapper'));
    const records=cards.map(card=>{
     const product=card.querySelector('.searchx-product-e-title a');
     const company=card.querySelector('a.searchx-product-e-company');
     if(!product||!company||!product.innerText.trim()||!company.innerText.trim())return null;
     return {productName:product.innerText.trim(),productUrl:product.href,companyName:company.innerText.trim(),companyUrl:company.href,pageText:card.innerText};
    }).filter(record=>record!==null);
    return {visibleCards:cards.length,records};
   });
   if(!capture.records.length)throw new Error('SOURCE_FIELDS_UNAVAILABLE');
   result={protocol:1,kind:'captured',sourcePageUrl:p.url(),query,observedAt:new Date().toISOString(),scope:'first_results_page',snapshot:final.tree,...capture};
  } catch {
   result={protocol:1,kind:'unavailable',reason:'ASIDE_SITE_OR_LAYOUT_UNAVAILABLE'};
  } finally { if(p)await closeTab(p); }
  emit(result);
 }
 return 'await ('+search.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
