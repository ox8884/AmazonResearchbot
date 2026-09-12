import {savedSearchFilters} from '../../packages/domain/src/saved-search.ts';
import {readFile} from 'node:fs/promises';

export function savedSearchExportScript(request,marker){
 const filters=savedSearchFilters.parse(request.filters);
 if(filters.competition!==undefined||filters.seasonality!==undefined)throw new Error('SEARCH_FILTER_REQUIRES_MAPPING');
 async function collect(request,marker){
  let p,result;
  try{
   p=await openTab('https://members.junglescout.com/#/opportunity-finder');
   const destination=async()=>p.evaluate(()=>location.origin+location.pathname+location.hash);
   const sourcePageUrl='https://members.junglescout.com/#/opportunity-finder';
   if(await destination()!==sourcePageUrl)throw new Error('SITE_CHANGED');
   await snapshot(p,{interactive:true});
   await p.locator('[data-testid="Home & Kitchen"]').waitFor({state:'visible',timeout:20000});
   if((await p.getByRole('combobox',{name:'Select Marketplace',exact:true}).evaluate(el=>el.innerText)).trim()!=='United States')throw new Error('MARKETPLACE_NOT_US');
   await p.getByRole('button',{name:'Reset Filters',exact:true}).click();
   await snapshot(p,{interactive:true});
   const mins=p.locator('input[placeholder="Min"]'),maxs=p.locator('input[placeholder="Max"]');
   if(await mins.count()!==6||await maxs.count()!==6)throw new Error('FILTER_LAYOUT_CHANGED');
   const categories=()=>p.locator('[role="checkbox"]').evaluateAll(els=>els.filter(el=>el.getAttribute('aria-checked')==='true').map(el=>el.id));
   if((await categories()).length)throw new Error('FILTER_RESET_UNCONFIRMED');
   await p.locator('[data-testid="Home & Kitchen"]').click();
   const filters=request.filters;
   if(filters.priceMinUsd!==undefined)await mins.nth(1).fill(filters.priceMinUsd);
   if(filters.priceMaxUsd!==undefined)await maxs.nth(1).fill(filters.priceMaxUsd);
   if(filters.monthlySearchMin!==undefined)await mins.nth(2).fill(String(filters.monthlySearchMin));
   const buckets=['Very Low','Low','Medium','High','Very High'];
   async function range(label,upper){
    const control=p.getByText(label,{exact:true}).first();
    if(upper!==undefined&&upper!=='Very High'){
     await control.evaluate(el=>el.parentElement.parentElement.scrollIntoView({block:'center',inline:'center'}));
     const geometry=await control.evaluate(el=>{
      const root=el.parentElement.parentElement;
      const low=root.querySelector('.slider-handle.main').getBoundingClientRect(),high=root.querySelector('.slider-handle.secondary').getBoundingClientRect();
      return {low:low.x+low.width/2,high:high.x+high.width/2,y:high.y+high.height/2};
     });
     await p.mouse.move(geometry.high,geometry.y);await p.mouse.down();
     try{await p.mouse.move(geometry.low+(geometry.high-geometry.low)*buckets.indexOf(upper)/4,geometry.y,{steps:10});}
     finally{await p.mouse.up();}
    }
    const values=await control.evaluate(el=>[...el.parentElement.parentElement.querySelectorAll('.slider-handle-info')].map(value=>value.innerText.trim()));
    if(values.length!==2||values[0]!=='Very Low'||values[1]!==(upper??'Very High'))throw new Error('FILTER_NOT_APPLIED');
    return values;
   }
   const competition=await range('Competition',filters.competitionMax),seasonality=await range('Seasonality',filters.seasonalityMax);
   async function verifyFilters(){
    const labels=await mins.evaluateAll(els=>els.map(el=>{
     for(let parent=el.parentElement;parent;parent=parent.parentElement){
      if(parent.querySelectorAll('input[placeholder="Min"]').length===1&&parent.querySelectorAll('input[placeholder="Max"]').length===1&&parent.innerText.trim())return parent.innerText.trim().replace(/\s+/g,' ');
     }
     return null;
    }));
    if(JSON.stringify(labels)!==JSON.stringify(['Average Monthly Units Sold','Average Monthly Price','Monthly Search Volume','Niche Score','30-Day Search Trend','90-Day Search Trend']))throw new Error('FILTER_LABELS_CHANGED');
    const lower=await mins.evaluateAll(els=>els.map(el=>el.value.replaceAll(',',''))),upper=await maxs.evaluateAll(els=>els.map(el=>el.value.replaceAll(',','')));
    const expectedLower=['',filters.priceMinUsd??'',filters.monthlySearchMin===undefined?'':String(filters.monthlySearchMin),'','',''];
    const expectedUpper=['',filters.priceMaxUsd??'','','','',''];
    if(JSON.stringify(lower)!==JSON.stringify(expectedLower)||JSON.stringify(upper)!==JSON.stringify(expectedUpper))throw new Error('FILTER_NOT_APPLIED');
    if(JSON.stringify(await categories())!==JSON.stringify(['Home & Kitchen']))throw new Error('CATEGORY_NOT_APPLIED');
    const words=await p.locator('input[placeholder="Enter words separated by comma"]').evaluateAll(els=>els.map(el=>el.value));
    if(words.length!==2||words.some(Boolean))throw new Error('UNEXPECTED_KEYWORD_FILTER');
    for(const [label,expected] of [['Competition',competition],['Seasonality',seasonality]]){
     const actual=await p.getByText(label,{exact:true}).first().evaluate(el=>[...el.parentElement.parentElement.querySelectorAll('.slider-handle-info')].map(value=>value.innerText.trim()));
     if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('FILTER_CHANGED');
    }
    if((await p.getByRole('combobox',{name:'Select Marketplace',exact:true}).evaluate(el=>el.innerText)).trim()!=='United States')throw new Error('MARKETPLACE_CHANGED');
    return {lower,upper};
   }
   const applied=await verifyFilters();
   const before=await snapshot(p,{interactive:true});
   if(await p.getByRole('table',{name:'Opportunity Finder Table',exact:true}).count())throw new Error('PREVIOUS_RESULTS_PRESENT');
   await p.getByRole('button',{name:'Search',exact:true}).click();
   await snapshot(p,{interactive:true});
   const table=p.getByRole('table',{name:'Opportunity Finder Table',exact:true});
   await table.waitFor({state:'visible',timeout:30000});
   const after=await snapshot(p,{selector:'[role="table"][aria-label="Opportunity Finder Table"]'});
   const records=await table.evaluate(el=>[...el.querySelectorAll('[role="rowgroup"] [role="row"]')].map(row=>{
    const cell=row.querySelectorAll('[role="cell"]')[1];
    const spans=cell?[...cell.querySelectorAll('span')]:[];
    return {keyword:spans[0]?.innerText.trim()??'',dominantCategory:spans[1]?.innerText.trim()??''};
   }));
   if(!records.length||records.length>200||records.some(row=>!row.keyword||row.dominantCategory!=='Home & Kitchen'))throw new Error('RESULT_SCOPE_UNCONFIRMED');
   const shown=await p.getByRole('button',{name:String(records.length),exact:true}).evaluate(el=>el.parentElement.parentElement.innerText);
   const totalMatch=/^Displaying\s+(\d+)\s+of\s+([\d,]+)$/.exec(shown.trim());
   if(!totalMatch||Number(totalMatch[1])!==records.length)throw new Error('RESULT_COUNT_UNCONFIRMED');
   const totalResults=Number(totalMatch[2].replaceAll(',',''));
   if(!Number.isSafeInteger(totalResults)||totalResults<records.length)throw new Error('RESULT_COUNT_UNCONFIRMED');
   const buttons=await snapshot(p,{interactive:true});
   const downloadRef=/- button[^\n]*\[ref=((?:f\d+)?e\d+)\][^\n]*:\n\s+- img "DOWNLOAD"\n\s+- text: "Download CSV"/.exec(buttons.tree)?.[1];
   if(!downloadRef)throw new Error('DOWNLOAD_UNAVAILABLE');
   const waiting=p.waitForEvent('download',{timeout:20000}).catch(()=>null);
   await p.locator(downloadRef).click();
   const download=await waiting;
   if(!download)throw new Error('DOWNLOAD_UNCONFIRMED');
   const filename=download.suggestedFilename(),downloadPath=await download.path();
   const bytes=await readFile(downloadPath);
   if(bytes.length===0||bytes.length>2*1024*1024||!/^Jungle Scout Opportunity Finder CSV Export - [^/\\]+\.csv$/.test(filename))throw new Error('EXPORT_UNCONFIRMED');
   if(await destination()!==sourcePageUrl)throw new Error('SITE_CHANGED');
   await verifyFilters();
   result={protocol:1,kind:'captured',scope:'opportunity_finder_export',sourcePageUrl,observedAt:new Date().toISOString(),
    searchRunId:request.searchRunId,searchId:request.searchId,revision:request.revision,
    marketplace:'us',discoveryCategory:'Home & Kitchen',filters,applied:{...applied,competition,seasonality},
    records,totalResults,page:1,filename,csvBase64:bytes.toString('base64'),snapshot:before.tree+'\n'+after.tree};
  }catch{result={protocol:1,kind:'unavailable',reason:'ASIDE_SEARCH_OR_EXPORT_UNCONFIRMED'};}
  finally{if(p)await closeTab(p);}
  console.log(marker+JSON.stringify(result));
 }
 return 'await ('+collect.toString()+')('+JSON.stringify({...request,filters})+','+JSON.stringify(marker)+')';
}
