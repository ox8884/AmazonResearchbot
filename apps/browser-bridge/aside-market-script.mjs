export function amazonMarketScript(query,marker){
 async function collect(query,marker){
  let page,result;
  try{
   page=await openTab('https://www.amazon.com/s?k='+encodeURIComponent(query).replace(/%20/g,'+'));
   await snapshot(page,{interactive:true,selector:'[role="search"]'});
   const input=page.getByRole('searchbox',{name:'Search Amazon',exact:true});
   const fallback=page.locator('#twotabsearchtextbox');
   const inputCount=await input.count(), fallbackCount=await fallback.count();
   if(inputCount!==1 && fallbackCount!==1)throw Error('AMAZON_SEARCHBOX_UNAVAILABLE');
   const searchInput=inputCount===1?input:fallback;
   await searchInput.waitFor({state:'visible',timeout:10000});
   const root=page.locator('.s-main-slot');
   await root.waitFor({state:'visible',timeout:25000});
   await page.locator('[data-component-type="s-result-info-bar"]').waitFor({state:'visible',timeout:25000});
   if(await searchInput.evaluate(el=>el.value)!==query)throw Error('QUERY_CHANGED');
   const sortBox=page.getByRole('combobox',{name:'Sort by:',exact:true});
   const sort=await sortBox.count()?await sortBox.evaluate(el=>el.value):'relevanceblender';
   if(sort!=='relevanceblender')throw Error('SORT_CHANGED');
   const rangeText=(await page.locator('[data-component-type="s-result-info-bar"]').innerText()).split(/\r?\n/)[0].trim().replace(/\s+/g,' ');
   if(!/^1[-–]\d+\s+of\b/.test(rangeText)||!rangeText.includes(query))throw Error('FIRST_PAGE_RANGE_UNCONFIRMED');
   const rangeEnd=Number(/^1[-–](\d+)\s/.exec(rangeText)?.[1]);
   if(!Number.isSafeInteger(rangeEnd)||rangeEnd<1||rangeEnd>200)throw Error('FIRST_PAGE_RANGE_UNCONFIRMED');
   const capture=()=>root.evaluate(root=>[...root.querySelectorAll(':scope > [data-component-type="s-search-result"]')]
    .filter(card=>card.getClientRects().length>0&&getComputedStyle(card).visibility==='visible')
    .map((card,index)=>{
    const candidate=card.getAttribute('data-asin'),asin=/^[A-Z0-9]{10}$/.test(candidate??'')?candidate:null;
    const titleLink=card.querySelector('.s-title-instructions-style a.a-text-normal'),image=card.querySelector('img.s-image');
    const title=titleLink?.innerText.trim()||null,alt=image?.alt??'',href=titleLink?.href??'';
    const sponsored=/^Sponsored Ad\b/i.test(alt)||/\/sspa\/click\?|\/gp\/slredirect\//.test(href)||/^Sponsored$/m.test(card.innerText);
    const priceTexts=[...new Set([...card.querySelectorAll('.a-price:not(.a-text-price) .a-offscreen')].filter(el=>{
     const parent=el.closest('.a-price');return parent&&parent.getClientRects().length>0&&getComputedStyle(parent).visibility==='visible';
    }).map(el=>el.textContent.trim()).filter(value=>value&&card.innerText.includes(value)))];
    let imageUrl=image?.src??null;
    if(!imageUrl||!/^https:\/\/m\.media-amazon\.com\/images\/[^?#\s\\]+$/.test(imageUrl))imageUrl=null;
    return {position:index+1,asin,title,productUrl:asin?'https://www.amazon.com/dp/'+asin:null,imageUrl,
     adStatus:sponsored?'sponsored':alt&&title?'not_marked':'unknown',priceTexts,sourceText:card.innerText+'\n'+alt};
   }));
   let slots=await capture();
   const view=await snapshot(page,{selector:'.s-main-slot'});
   const finalSlots=await capture();
   if(JSON.stringify(slots)!==JSON.stringify(finalSlots))throw Error('RESULTS_CHANGED_DURING_CAPTURE');
   slots=finalSlots;
   if(!slots.length||slots.length>200)throw Error('RESULTS_UNAVAILABLE');
   if(await searchInput.evaluate(el=>el.value)!==query)throw Error('QUERY_CHANGED');
   const sourcePageUrl=await page.evaluate(()=>location.href);
   const unmarked=slots.filter(slot=>slot.adStatus==='not_marked');
   const coverage=unmarked.length===rangeEnd&&unmarked.every(slot=>slot.asin&&slot.title)&&slots.every(slot=>slot.adStatus!=='unknown')?'complete':'partial';
   result={protocol:1,kind:'captured',scope:'amazon_search_first_page',query,marketplace:'us',sort:'featured',sourcePageUrl,
    observedAt:new Date().toISOString(),rangeText,rangeEnd,coverage,slots,snapshot:view.tree};
  }catch{result={protocol:1,kind:'unavailable',reason:'AMAZON_SEARCH_SOURCE_UNCONFIRMED'};}
  finally{if(page)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_SEARCH_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
