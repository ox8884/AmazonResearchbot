export function productDatabaseScript(query,marker){
 async function collect(query,marker){
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
   await ensureChecked('Home & Kitchen','CATEGORY_FILTER_UNCONFIRMED');
   await ensureChecked('Standard','PRODUCT_TIER_FILTER_UNCONFIRMED');
   stage='QUERY';
   const input=page.getByRole('textbox',{name:'Enter words and/or ASINs separated by commas',exact:true}).first();
   await input.waitFor({state:'visible',timeout:20_000});
   await input.fill(query);
   if(await input.evaluate(el=>el.value)!==query)throw Error('QUERY_NOT_APPLIED');
   stage='RESULTS';
   await page.getByRole('button',{name:'Search',exact:true}).click();
   const table=page.getByRole('table',{name:'Product Database Table',exact:true});
   await table.waitFor({state:'visible',timeout:30_000});
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
   if(queryTokens.length&&!records.some(record=>queryTokens.every(token=>record.sourceText.toLowerCase().includes(token))))throw Error('RESULT_QUERY_UNCONFIRMED');
   if(await input.evaluate(el=>el.value)!==query||await destination()!==sourcePageUrl)throw Error('QUERY_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_product_database',query,marketplace:'us',category:'Kitchen & Dining',discoveryCategory:'Home & Kitchen',productTier:'Standard',resultLimit:100,displayedCount,totalCount,coverage,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,records};
  }catch(error){
   const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PRODUCT_DATABASE_'+stage+'_UNCONFIRMED';
   result={protocol:1,kind:'unavailable',reason};
  }
  finally{if(page&&owned)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_PRODUCT_DATABASE_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
