export function keywordScoutScript(query,marker){
 async function collect(query,marker){
  let page,result;
  try{
   page=await openTab('https://members.junglescout.com/keyword-scout');
   const destination=()=>page.evaluate(()=>location.href);
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?keyword-scout(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   const input=page.getByRole('textbox',{name:/search keywords/i}).first();
   await input.waitFor({state:'visible',timeout:20_000});
   await input.fill(query);
   if(await input.evaluate(el=>el.value)!==query)throw Error('QUERY_NOT_APPLIED');
   await page.getByRole('button',{name:/search/i}).first().click();
   const body=page.locator('body');
   await body.waitFor({state:'visible',timeout:30_000});
   const snapshotResult=await snapshot(page,{selector:'body'});
   const extracted=await body.evaluate(body=>{
    const text=node=>node.innerText.replace(/\s+/g,' ').trim();
    const metricLabels=['Search Volume','Search Volume Trend','Ease to Rank','PPC Bid','Recommended Promotions','30-Day Trend','90-Day Trend'];
    const metrics=[...body.querySelectorAll('tr,[role="row"],section,article,div')].flatMap(node=>{
      const sourceText=text(node);if(!sourceText||sourceText.length>10000)return [];
      const label=metricLabels.find(candidate=>new RegExp('\\b'+candidate.replace(/ /g,'\\s+')+'\\b','i').test(sourceText));
      if(!label)return [];
      const remainder=sourceText.replace(new RegExp('^.*?'+label.replace(/ /g,'\\s*')+'\\s*:?\\s*','i'),'').trim();
      const value=remainder.split(/(?=\b(?:Search Volume|Ease to Rank|PPC Bid|Recommended Promotions|30-Day Trend|90-Day Trend)\b)/i)[0]?.trim();
      return value?[{label,value,sourceText}]:[];
    });
    const relatedKeywords=[...body.querySelectorAll('a,button')].flatMap(node=>{
      const keyword=text(node);const sourceText=node.parentElement?text(node.parentElement):keyword;
      return keyword&&sourceText&&keyword.length<=500&&sourceText.length<=10000&&/related|keyword/i.test(sourceText)?[{keyword,sourceText}]:[];
    });
    const asinRelations=[...body.querySelectorAll('tr,[role="row"],li')].flatMap(node=>{
      const sourceText=text(node);const asin=/\b[A-Z0-9]{10}\b/.exec(sourceText)?.[0];
      return asin?[{asin,sourceText}]:[];
    });
    const unique=(items,key)=>[...new Map(items.map(item=>[key(item),item])).values()];
    return {metrics:unique(metrics,item=>item.label+'\\n'+item.value),relatedKeywords:unique(relatedKeywords,item=>item.keyword),asinRelations:unique(asinRelations,item=>item.asin)};
   });
   if(await input.evaluate(el=>el.value)!==query||await destination()!==sourcePageUrl)throw Error('QUERY_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_keyword_scout',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,...extracted};
  }catch{result={protocol:1,kind:'unavailable',reason:'KEYWORD_SCOUT_SOURCE_UNCONFIRMED'};}
  finally{if(page)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_KEYWORD_SCOUT_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
