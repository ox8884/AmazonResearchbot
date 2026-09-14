export function historicalDataScript(query,marker){
 async function collect(query,marker){
  let page,result;
  try{
   page=await openTab('https://members.junglescout.com/historical-data');
   const destination=()=>page.evaluate(()=>location.href);
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?historical-data(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   const input=page.getByRole('textbox',{name:/search|asin|keyword/i}).first();
   await input.waitFor({state:'visible',timeout:20_000});
   await input.fill(query);
   if(await input.evaluate(el=>el.value)!==query)throw Error('QUERY_NOT_APPLIED');
   await page.getByRole('button',{name:/search|apply/i}).first().click();
   const body=page.locator('body');
   await body.waitFor({state:'visible',timeout:30_000});
   const snapshotResult=await snapshot(page,{selector:'body'});
   const extracted=await body.evaluate(body=>{
    const text=node=>node.innerText.replace(/\s+/g,' ').trim();
    const bodyText=text(body);
    const datePattern=/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}\b/g;
    const dates=[...bodyText.matchAll(datePattern)].map(match=>match[0]);
    const dateRange=dates.length>=2?{label:dates[0]+' – '+dates[dates.length-1],start:new Date(dates[0]).toISOString(),end:new Date(dates[dates.length-1]).toISOString()}:null;
    const knownMetrics=['Price','Sales Rank','Units Sold','Sales','Search Volume'];
    const series=[...body.querySelectorAll('tr,[role="row"],li,section,article')].flatMap(node=>{
      const sourceText=text(node);if(!sourceText||sourceText.length>10000)return [];
      const metric=knownMetrics.find(label=>new RegExp('\\b'+label.replace(/ /g,'\\s+')+'\\b','i').test(sourceText));
      const periodLabel=[...sourceText.matchAll(datePattern)][0]?.[0];
      if(!metric||!periodLabel)return [];
      const remainder=sourceText.replace(new RegExp('^.*?'+metric.replace(/ /g,'\\s*')+'\\s*:?\\s*','i'),'').trim();
      const value=remainder.replace(periodLabel,'').trim().split(/\s{2,}/)[0];
      return value?[{metric,periodLabel,value,sourceText}]:[];
    });
    const unique=[...new Map(series.map(point=>[point.metric+'\n'+point.periodLabel+'\n'+point.value,point])).values()];
    return {dateRange,series:unique};
   });
   if(await input.evaluate(el=>el.value)!==query||await destination()!==sourcePageUrl)throw Error('QUERY_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_historical_data',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,...extracted};
  }catch{result={protocol:1,kind:'unavailable',reason:'HISTORICAL_DATA_SOURCE_UNCONFIRMED'};}
  finally{if(page)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_HISTORICAL_DATA_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
