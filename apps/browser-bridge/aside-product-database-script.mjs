// asins: Amazon first-page ASINs to look up instead of the keyword (no category or tier filters then).
export function productDatabaseScript(query,marker,asins=null){
 async function collect(query,marker,asins){
  let page,result,owned=false,stage='OPEN';
  try{
   const existing=(await listBrowserTabs()).find(tab=>typeof tab.targetId==='string'&&typeof tab.url==='string'&&/^https:\/\/members\.junglescout\.com\//.test(tab.url));
   if(existing)page=await attachBrowserTab(existing.targetId);
   else {page=await openTab('https://members.junglescout.com/#/database');owned=true;}
   stage='NAVIGATION';
   const destination=()=>page.evaluate(()=>location.href);
   const databaseUrl='https://members.junglescout.com/#/database';
   if(await destination()!==databaseUrl){
    try{await page.goto(databaseUrl);}catch(error){if(await destination()!==databaseUrl)throw error;}
   }
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?database(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   stage='FILTERS';
   const marketplace=page.getByRole('combobox',{name:'Select Marketplace',exact:true});
   await marketplace.waitFor({state:'visible',timeout:20_000});
   const marketplaceValue=await marketplace.evaluate(el=>(el.getAttribute('aria-valuetext')||el.innerText||el.textContent||'').replace(/\s+/g,' ').trim());
   if(marketplaceValue!=='United States')throw Error('MARKETPLACE_FILTER_UNCONFIRMED');
   const stateFor=label=>label.evaluate(el=>{
    for(let node=el;node&&node!==document.body;node=node.parentElement){
     const control=node.matches('input[type="checkbox"],[role="checkbox"]')?node:node.querySelector('input[type="checkbox"],[role="checkbox"]');
     if(control)return {found:true,checked:control.checked===true||control.getAttribute('aria-checked')==='true'};
    }
    return {found:false,checked:false};
   });
   const ensureChecked=async(name,reason)=>{
    const label=page.getByText(name,{exact:true}).first();
    await label.waitFor({state:'visible',timeout:20_000});
    let state=await stateFor(label);
    if(!state.found)throw Error(reason);
    if(!state.checked){await label.click();state=await stateFor(label);}
    if(!state.checked)throw Error(reason);
   };
   if(asins){
    // An ASIN lookup must not be narrowed by leftover filters.
    await page.getByRole('button',{name:'Reset Filters',exact:true}).click();
    for(const name of ['Home & Kitchen','Standard'])if((await stateFor(page.getByText(name,{exact:true}).first())).checked)throw Error('FILTER_RESET_UNCONFIRMED');
   }else{
    await ensureChecked('Home & Kitchen','CATEGORY_FILTER_UNCONFIRMED');
    await ensureChecked('Standard','PRODUCT_TIER_FILTER_UNCONFIRMED');
   }
   stage='QUERY';
   const input=page.getByRole('textbox',{name:'Enter words and/or ASINs separated by commas',exact:true}).first();
   await input.waitFor({state:'visible',timeout:20_000});
   const searchText=asins?asins.join(', '):query;
   await input.fill(searchText);
   if(await input.evaluate(el=>el.value)!==searchText)throw Error('QUERY_NOT_APPLIED');
   stage='RESULTS';
   await page.getByRole('button',{name:'Search',exact:true}).click();
   const table=page.getByRole('table',{name:'Product Database Table',exact:true});
   await table.waitFor({state:'visible',timeout:30_000});
   // The result footer renders after the table; wait for it instead of checking once.
   await page.getByText(/Displaying/).first().waitFor({state:'visible',timeout:20_000}).catch(()=>{});
   const limitTriggers=page.locator('[data-testid="multi-select-trigger"]');
   const limitIndex=await limitTriggers.evaluateAll(triggers=>triggers.findIndex(trigger=>(trigger.parentElement?.parentElement?.innerText||'').includes('Displaying')));
   if(limitIndex<0)throw Error('RESULT_LIMIT_CONTROL_UNCONFIRMED');
   const resultLimit=limitTriggers.nth(limitIndex);
   const currentLimit=(await resultLimit.evaluate(el=>(el.innerText||'').trim())).match(/^(?:25|50|100)/)?.[0]??null;
   if(!currentLimit)throw Error('RESULT_LIMIT_CONTROL_UNCONFIRMED');
   await resultLimit.waitFor({state:'visible',timeout:20_000});
   if(await resultLimit.evaluate(el=>(el.innerText||'').trim())!=='100'){
    await resultLimit.click();
    await page.getByRole('option',{name:'100',exact:true}).click();
   }
   if(!/^100\b/.test((await resultLimit.evaluate(el=>(el.innerText||'').trim()))))throw Error('RESULT_LIMIT_UNCONFIRMED');
   await table.waitFor({state:'visible',timeout:30_000});
   stage='SORT';
   // Sort by monthly revenue, highest first, so a partial view still holds the overall leader. The sort is
   // reported only when the visible revenues really come back in descending order; otherwise it is omitted.
   const revenueColumn=()=>table.evaluate(table=>[...table.querySelectorAll('[role="row"]')].slice(1)
    .filter(row=>row.getClientRects().length>0).map(row=>([...row.querySelectorAll('[role="cell"]')][6]?.innerText||'').replace(/\s+/g,' ').trim()));
   const descending=values=>{
    const numbers=values.map(value=>/^\$?\d[\d,]*(?:\.\d{1,2})?$/.test(value)?Number(value.replace(/[$,]/g,'')):null);
    const known=numbers.filter(value=>value!==null);
    return known.length>1&&numbers.slice(0,known.length).every(value=>value!==null)&&known.every((value,index)=>index===0||value<=known[index-1]);
   };
   let revenueSort;
   const revenueHeader=page.getByRole('columnheader',{name:/revenue/i}).first();
   for(let click=0;;click++){
    if(descending(await revenueColumn())){revenueSort='descending';break;}
    if(click===2||!(await revenueHeader.count()))break;
    await revenueHeader.click();
    for(let wait=0;wait<20&&!descending(await revenueColumn());wait++)await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,500)));
   }
   const snapshotResult=await snapshot(page,{selector:'[role="table"]'});
   const records=await table.evaluate(table=>[...table.querySelectorAll('[role="row"]')].slice(1).flatMap(row=>{
    if(row.getClientRects().length===0||getComputedStyle(row).visibility!=='visible')return [];
    const sourceText=row.innerText.replace(/\s+/g,' ').trim();
    const asin=/\b[A-Z0-9]{10}\b/.exec(sourceText)?.[0];
    const cells=[...row.querySelectorAll('[role="cell"]')].map(cell=>cell.innerText.replace(/\s+/g,' ').trim());
    const title=cells[1]?.replace(/\s*\b[A-Z0-9]{10}\b\s*$/,'').trim()??'';
    const observed=index=>!cells[index]||/^(?:No Data|--|-)$/.test(cells[index])?null:cells[index];
    return asin&&title&&sourceText.includes(asin)&&sourceText.includes(title)?[{
     asin,title,brand:observed(2),categoryPath:observed(3),bsr:observed(4),unitsSoldMonthly:observed(5),
     revenueMonthly:observed(6),price:observed(7),reviews:observed(8),starRating:observed(9),sellers:observed(10),
     dimensions:observed(13),weight:observed(14),sourceText,
    }]:[];
   }));
   if(!records.length||records.length>200||new Set(records.map(record=>record.asin)).size!==records.length)throw Error('RESULT_SCOPE_UNCONFIRMED');
   const resultScopeText=await resultLimit.evaluate(el=>(el.parentElement?.parentElement?.innerText||'').replace(/\s+/g,' ').trim());
   const totalText=/\bof\s+([\d,]+)\b/i.exec(resultScopeText)?.[1]??null;
   const totalCount=totalText===null?null:Number(totalText.replace(/,/g,''));
   if(!Number.isSafeInteger(totalCount)||totalCount<records.length)throw Error('RESULT_COUNT_UNCONFIRMED');
   const displayedCount=records.length,coverage=displayedCount===totalCount?'complete':'partial';
   const queryTokens=query.toLowerCase().match(/[a-z0-9]+/g)?.filter(token=>token.length>1)??[];
   if(asins&&records.some(record=>!asins.includes(record.asin)))throw Error('RESULT_SCOPE_UNCONFIRMED');
   if(!asins&&queryTokens.length&&!records.some(record=>queryTokens.every(token=>record.sourceText.toLowerCase().includes(token))))throw Error('RESULT_QUERY_UNCONFIRMED');
   const finalPageUrl=await destination();
   if(await input.evaluate(el=>el.value)!==searchText||!/^https:\/\/members\.junglescout\.com\/(?:#\/)?database(?:[/?#].*)?$/.test(finalPageUrl))throw Error('QUERY_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_product_database',query,marketplace:'us',...(asins?{requestedAsins:asins}:{category:'Kitchen & Dining',discoveryCategory:'Home & Kitchen',productTier:'Standard'}),resultLimit:100,displayedCount,totalCount,coverage,...(revenueSort?{revenueSort}:{}),sourcePageUrl:finalPageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,records};
  }catch(error){
   const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PRODUCT_DATABASE_'+stage+'_UNCONFIRMED';
   result={protocol:1,kind:'unavailable',reason};
  }
  finally{if(page&&owned)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_PRODUCT_DATABASE_QUERY');
 if(asins!==null&&(!Array.isArray(asins)||!asins.length||asins.length>100||asins.some(asin=>typeof asin!=='string'||!/^[A-Z0-9]{10}$/.test(asin))))throw Error('INVALID_PRODUCT_DATABASE_ASINS');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+','+JSON.stringify(asins)+')';
}
