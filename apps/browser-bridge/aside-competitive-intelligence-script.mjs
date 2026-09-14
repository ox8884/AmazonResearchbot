export function competitiveIntelligenceScript(query,marker){
 async function collect(query,marker){
  let page,result,owned=false,stage='OPEN';
  try{
   const existing=(await listBrowserTabs()).find(tab=>typeof tab.targetId==='string'&&typeof tab.url==='string'&&/^https:\/\/members\.junglescout\.com\//.test(tab.url));
   if(existing)page=await attachBrowserTab(existing.targetId);
   else {page=await openTab('https://members.junglescout.com/#/competitive-intelligence');owned=true;}
   const destination=()=>page.evaluate(()=>location.href);
   stage='NAVIGATION';
   await page.goto('https://members.junglescout.com/#/competitive-intelligence');
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?competitive-intelligence(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   const body=page.locator('body');
   await body.waitFor({state:'visible',timeout:30_000});
   const gateSnapshot=await snapshot(page,{selector:'body'});
   const bodyText=await body.evaluate(node=>node.innerText.replace(/\s+/g,' ').trim());
   const upgradeRequired=/Access Competitive Intelligence and more by upgrading now|Upgrade to Brand Owner|Brand Owner Plan/i.test(bodyText);
   const currentPlan=/\bYour Plan\s+(\$[\d,]+\/yr)\b/i.exec(bodyText)?.[1]??null;
   const requiredPlan=/\bBrand Owner Plan\s+(\$[\d,]+\/yr)\b/i.exec(bodyText)?.[1]??(bodyText.includes('Brand Owner')?'Brand Owner':null);
   const entitlement=upgradeRequired?{status:'upgrade_required',currentPlan,requiredPlan,sourcePageUrl,sourceText:bodyText}:null;
   if(upgradeRequired){
    stage='PRODUCT_DATABASE_FALLBACK';
    await page.goto('https://members.junglescout.com/#/database');
    const databasePageUrl=await destination();
    if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?database(?:[/?#].*)?$/.test(databasePageUrl))throw Error('SITE_CHANGED');
    const marketplaceSelected=await page.locator('[role="combobox"]').evaluateAll(controls=>controls.some(control=>control.getClientRects().length>0&&(control.innerText||'').trim()==='United States'));
    if(!marketplaceSelected)throw Error('MARKETPLACE_NOT_US');
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
    const input=page.getByRole('textbox',{name:'Enter words and/or ASINs separated by commas',exact:true}).first();
    await input.waitFor({state:'visible',timeout:20_000});
    await input.fill(query);
    if(await input.evaluate(element=>element.value)!==query)throw Error('QUERY_NOT_APPLIED');
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
    const databaseSnapshot=await snapshot(page,{selector:'[role="table"]'});
    const records=await table.evaluate(table=>[...table.querySelectorAll('[role="row"]')].slice(1).flatMap(row=>{
     if(row.getClientRects().length===0||getComputedStyle(row).visibility!=='visible')return [];
     const sourceText=row.innerText.replace(/\s+/g,' ').trim();
     const asin=/\b[A-Z0-9]{10}\b/.exec(sourceText)?.[0];
     const cells=[...row.querySelectorAll('[role="cell"]')].map(cell=>cell.innerText.replace(/\s+/g,' ').trim());
     const observed=index=>!cells[index]||/^(?:No Data|--|-)$/i.test(cells[index])?null:cells[index];
     return asin?[{asin,brand:observed(2),categoryPath:observed(3),price:observed(7),reviews:observed(8),sales:observed(5),revenue:observed(6),sourceText}]:[];
    }));
    if(await input.evaluate(element=>element.value)!==query||await destination()!==databasePageUrl)throw Error('QUERY_CHANGED');
    const resultScopeText=await resultLimit.evaluate(el=>(el.parentElement?.parentElement?.innerText||'').replace(/\s+/g,' ').trim());
    const totalText=/\bof\s+([\d,]+)\b/i.exec(resultScopeText)?.[1]??null;
    const totalCount=totalText===null?null:Number(totalText.replace(/,/g,''));
    if(!Number.isSafeInteger(totalCount)||totalCount<records.length)throw Error('RESULT_COUNT_UNCONFIRMED');
    const displayedCount=records.length,coverage=displayedCount===totalCount?'complete':'partial';
    const queryTokens=query.toLowerCase().match(/[a-z0-9]+/g)?.filter(token=>token.length>1)??[];
    if(records.length>200||new Set(records.map(record=>record.asin)).size!==records.length||
       (queryTokens.length&&!records.some(record=>queryTokens.every(token=>record.sourceText.toLowerCase().includes(token)))))throw Error('RESULT_SCOPE_UNCONFIRMED');
    const numericRevenue=value=>{if(typeof value!=='string'||!/^\$\s*\d[\d,]*(?:\.\d{1,2})?$/.test(value.trim()))return null;const parsed=Number(value.replace(/[$,\s]/g,''));return Number.isFinite(parsed)?parsed:null;};
    const confirmsKitchenDining=value=>typeof value==='string'&&value.split(/\s*>\s*/).some(segment=>segment.trim().toLowerCase()==='kitchen & dining');
    const ranked=records.filter(record=>confirmsKitchenDining(record.categoryPath)).map(record=>({record,revenue:numericRevenue(record.revenue)})).filter(entry=>entry.revenue!==null).sort((left,right)=>right.revenue-left.revenue);
    const best=ranked[0];
    const tied=best?ranked.filter(entry=>entry.revenue===best.revenue):[];
    const representativeAsin=coverage==='complete'&&best&&tied.length===1?best.record.asin:null;
    const representativeSelection=coverage!=='complete'?'insufficient_revenue_data':best?(tied.length===1?'unique_revenue_leader':'ambiguous_revenue_leader'):'insufficient_revenue_data';
    result={protocol:1,kind:'captured',scope:'jungle_scout_competitive_intelligence',query,sourcePageUrl:databasePageUrl,observedAt:new Date().toISOString(),snapshot:JSON.stringify({competitiveIntelligence:gateSnapshot.tree,productDatabase:databaseSnapshot.tree}),representativeAsin,representativeSelection,comparisonBasis:'product_database',displayedCount,totalCount,coverage,entitlement:{...entitlement,sourcePageUrl},competitors:records};
   }else{
    stage='QUERY';
    const input=page.getByRole('textbox').first();
    await input.waitFor({state:'visible',timeout:20_000});
    await input.fill(query);
    if(await input.evaluate(element=>element.value)!==query)throw Error('QUERY_NOT_APPLIED');
    const buttons=page.locator('button');
    const searchIndex=await buttons.evaluateAll(nodes=>nodes.findIndex(node=>node.getClientRects().length>0&&/^(?:search|apply)$/i.test((node.innerText||node.getAttribute('aria-label')||'').trim())));
    if(searchIndex<0)throw Error('SEARCH_CONTROL_UNCONFIRMED');
    const search=buttons.nth(searchIndex);
    await search.waitFor({state:'visible',timeout:20_000});
    await search.click();
    stage='RESULTS';
    const extracted=await body.evaluate(body=>{
     const text=node=>node.innerText.replace(/\s+/g,' ').trim();
     const labelled=(sourceText,label)=>{const match=new RegExp('\\b'+label.replace(/ /g,'\\s+')+'\\b\\s*:?\\s*([^|•]{1,120})','i').exec(sourceText);return match?.[1]?.trim()||null;};
     const candidates=[...body.querySelectorAll('tr,[role="row"],li,section,article')].flatMap(node=>{
      const sourceText=text(node);if(!sourceText||sourceText.length>30_000)return [];
      const asin=/\b[A-Z0-9]{10}\b/.exec(sourceText)?.[0];
      if(!asin)return [];
      return [{asin,brand:labelled(sourceText,'Brand'),price:labelled(sourceText,'Price'),reviews:labelled(sourceText,'Reviews'),sales:labelled(sourceText,'Sales'),revenue:labelled(sourceText,'Revenue'),sourceText}];
     });
     return {competitors:[...new Map(candidates.map(record=>[record.asin,record])).values()]};
    });
    if(!extracted.competitors.length||await input.evaluate(element=>element.value)!==query||await destination()!==sourcePageUrl)throw Error('RESULT_SCOPE_UNCONFIRMED');
    result={protocol:1,kind:'captured',scope:'jungle_scout_competitive_intelligence',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:gateSnapshot.tree,representativeAsin:null,comparisonBasis:'competitive_intelligence',competitors:extracted.competitors};
   }
  }catch(error){
   const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'COMPETITIVE_INTELLIGENCE_'+stage+'_UNCONFIRMED';
   result={protocol:1,kind:'unavailable',reason};
  }
  finally{if(page&&owned)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_COMPETITIVE_INTELLIGENCE_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
