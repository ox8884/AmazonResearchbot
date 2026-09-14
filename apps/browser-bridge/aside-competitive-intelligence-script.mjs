export function competitiveIntelligenceScript(query,marker){
 async function collect(query,marker){
  let page,result;
  try{
   page=await openTab('https://members.junglescout.com/');
   await page.getByRole('link',{name:'Competitive Intelligence',exact:true}).click();
   const destination=()=>page.evaluate(()=>location.href);
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?competitive-intelligence(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   const input=page.getByRole('textbox').first();
   await input.waitFor({state:'visible',timeout:20_000});
   await input.fill(query);
   if(await input.evaluate(element=>element.value)!==query)throw Error('QUERY_NOT_APPLIED');
   const search=page.getByRole('button',{name:/search|apply/i}).first();
   await search.waitFor({state:'visible',timeout:20_000});
   await search.click();
   const body=page.locator('body');
   await body.waitFor({state:'visible',timeout:30_000});
   const snapshotResult=await snapshot(page,{selector:'body'});
   const extracted=await body.evaluate(body=>{
    const text=node=>node.innerText.replace(/\s+/g,' ').trim();
    const labelled=(sourceText,label)=>{
      const match=new RegExp('\\b'+label.replace(/ /g,'\\s+')+'\\b\\s*:?\\s*([^|•]{1,120})','i').exec(sourceText);
      return match?.[1]?.trim()||null;
    };
    const candidates=[...body.querySelectorAll('tr,[role="row"],li,section,article')].flatMap(node=>{
      const sourceText=text(node);if(!sourceText||sourceText.length>30_000)return [];
      const asin=/\b[A-Z0-9]{10}\b/.exec(sourceText)?.[0];
      if(!asin)return [];
      return [{asin,brand:labelled(sourceText,'Brand'),price:labelled(sourceText,'Price'),reviews:labelled(sourceText,'Reviews'),sales:labelled(sourceText,'Sales'),revenue:labelled(sourceText,'Revenue'),sourceText}];
    });
    const competitors=[...new Map(candidates.map(record=>[record.asin,record])).values()];
    const bodyText=text(body);
    const representativeAsin=/\b(?:Representative|Primary)\s+(?:ASIN|Product)\b[^A-Z0-9]*([A-Z0-9]{10})/i.exec(bodyText)?.[1]??null;
    return {representativeAsin:competitors.some(record=>record.asin===representativeAsin)?representativeAsin:null,competitors};
   });
   if(!extracted.competitors.length||await input.evaluate(element=>element.value)!==query||await destination()!==sourcePageUrl)throw Error('RESULT_SCOPE_UNCONFIRMED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_competitive_intelligence',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,...extracted};
  }catch{result={protocol:1,kind:'unavailable',reason:'COMPETITIVE_INTELLIGENCE_SOURCE_UNCONFIRMED'};}
  finally{if(page)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_COMPETITIVE_INTELLIGENCE_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
