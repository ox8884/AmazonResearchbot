export function keywordScoutScript(query,marker){
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
   await input.fill(query);
   if(await input.evaluate(el=>el.value)!==query)throw Error('QUERY_NOT_APPLIED');
   stage='RESULTS';
   await page.getByRole('button',{name:'Search',exact:true}).click();
   const queryRow=page.getByText(query.trim(),{exact:true}).first();
   await queryRow.waitFor({state:'visible',timeout:60_000});
   const table=page.getByRole('table',{name:'Keyword Results',exact:true});
   await table.waitFor({state:'visible',timeout:60_000});
   stage='RESULT_SNAPSHOT';
   const snapshotResult=await snapshot(page,{selector:'[role="table"]'});
   stage='RESULT_EXTRACTION';
   const keywordRecords=await table.evaluate(table=>[...table.querySelectorAll('[role="row"]')].slice(1).flatMap(row=>{
    if(row.getClientRects().length===0||getComputedStyle(row).visibility!=='visible')return [];
    const cells=[...row.querySelectorAll('[role="cell"]')].map(cell=>cell.innerText.replace(/\s+/g,' ').trim());
    const sourceText=row.innerText.replace(/\s+/g,' ').trim(),keyword=cells[1]?.trim()??'';
    const observed=index=>!cells[index]||/^(?:No Data|--|-)$/.test(cells[index])?null:cells[index];
    return keyword&&sourceText.includes(keyword)?[{keyword,searchTrend30Day:observed(5),exactSearchVolume30Day:observed(6),category:observed(7),ppcBidExact:observed(8),ppcBidBroad:observed(9),easeToRank:observed(10),relevancyScore:observed(11),sourceText}]:[];
   }));
   if(!keywordRecords.length||keywordRecords.length>200||new Set(keywordRecords.map(record=>record.keyword)).size!==keywordRecords.length)throw Error('RESULT_SCOPE_UNCONFIRMED');
   const primary=keywordRecords.find(record=>record.keyword.toLowerCase()===query.trim().toLowerCase());
   if(!primary)throw Error('RESULT_QUERY_UNCONFIRMED');
   const metrics=[];
   const relatedKeywords=keywordRecords.filter(record=>record.keyword!==primary.keyword).map(record=>({keyword:record.keyword,sourceText:record.sourceText}));
   const extracted={metrics,relatedKeywords,asinRelations:[],keywordRecords};
   stage='RESULT_VERIFICATION';
   if(await input.evaluate(el=>el.value)!==query||await destination()!==sourcePageUrl)throw Error('QUERY_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_keyword_scout',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,...extracted};
  }catch(error){
   const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'KEYWORD_SCOUT_'+stage+'_UNCONFIRMED';
   result={protocol:1,kind:'unavailable',reason};
  }
  finally{if(page&&owned)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_KEYWORD_SCOUT_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
