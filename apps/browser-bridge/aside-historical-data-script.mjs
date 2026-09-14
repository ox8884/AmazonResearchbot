export function historicalDataScript(query,marker){
 async function collect(query,marker){
  let page,result,owned=false,stage='OPEN';
  try{
   const existing=(await listBrowserTabs()).find(tab=>typeof tab.targetId==='string'&&typeof tab.url==='string'&&/^https:\/\/members\.junglescout\.com\//.test(tab.url));
   if(existing)page=await attachBrowserTab(existing.targetId);
   else {page=await openTab('https://members.junglescout.com/#/keyword');owned=true;}
   stage='NAVIGATION';
   await page.goto('https://members.junglescout.com/#/keyword');
   const destination=()=>page.evaluate(()=>location.href);
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?keyword(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   stage='QUERY';
   const input=page.getByRole('textbox',{name:'Enter a Keyword or up to ten ASINs separated by commas',exact:true});
   await input.waitFor({state:'visible',timeout:20_000});
   const existingQuery=await input.evaluate(element=>element.value);
   let shouldSearch=existingQuery!==query;
   if(shouldSearch){
    await input.fill(query);
    if(await input.evaluate(element=>element.value)!==query)throw Error('QUERY_NOT_APPLIED');
   }
   stage='RESULTS';
   const table=page.getByRole('table',{name:'Keyword Results',exact:true});
   try{await table.waitFor({state:'visible',timeout:10_000});}catch{if(!shouldSearch)throw Error('RESULT_SCOPE_UNCONFIRMED');}
   if(shouldSearch){
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await table.waitFor({state:'visible',timeout:30_000});
   }
   stage='RESULT_SNAPSHOT';
   const snapshotResult=await snapshot(page,{selector:'[role="table"]'});
   stage='RESULT_EXTRACTION';
   const extracted=await table.evaluate((table,query)=>{
    const rows=[...table.querySelectorAll('[role="row"]')].slice(1).flatMap(row=>{
     if(row.getClientRects().length===0||getComputedStyle(row).visibility!=='visible')return [];
     const cells=[...row.querySelectorAll('[role="cell"]')].map(cell=>cell.innerText.replace(/\s+/g,' ').trim());
     const keyword=cells[1]??'',sourceText=row.innerText.replace(/\s+/g,' ').trim();
     return keyword.toLowerCase()===query.trim().toLowerCase()&&sourceText.includes(keyword)?[{searchTrend:cells[5]??null,exactSearchVolume:cells[6]??null,sourceText}]:[];
    });
    return rows[0]??null;
   },query);
   if(!extracted)throw Error('RESULT_SCOPE_UNCONFIRMED');
   const observed=value=>value&&!/^(?:No Data|--|-)$/.test(value)?value:null;
   const series=[];
   if(observed(extracted.searchTrend)!==null)series.push({metric:'Search Trend 30 Day',periodLabel:'30 Day',value:observed(extracted.searchTrend),sourceText:'Search Trend 30 Day 30 Day '+extracted.sourceText});
   if(observed(extracted.exactSearchVolume)!==null)series.push({metric:'Exact Search Volume 30 Day',periodLabel:'30 Day',value:observed(extracted.exactSearchVolume),sourceText:'Exact Search Volume 30 Day 30 Day '+extracted.sourceText});
   if(!series.length)throw Error('RESULT_SCOPE_UNCONFIRMED');
   if(await input.evaluate(element=>element.value)!==query||await destination()!==sourcePageUrl)throw Error('QUERY_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_historical_data',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,dateRange:null,series};
  }catch(error){
   const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'HISTORICAL_DATA_'+stage+'_UNCONFIRMED';
   result={protocol:1,kind:'unavailable',reason};
  }
  finally{if(page&&owned)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_HISTORICAL_DATA_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
