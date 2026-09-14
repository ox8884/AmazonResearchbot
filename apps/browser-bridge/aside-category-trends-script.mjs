export function categoryTrendsScript(query,marker){
 async function collect(query,marker){
  let page,result;
  try{
   page=await openTab('https://members.junglescout.com/');
   await page.getByRole('link',{name:'Category Trends',exact:true}).click();
   const destination=()=>page.evaluate(()=>location.href);
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?category-trends(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   const category=page.getByRole('combobox').nth(1);
   await category.waitFor({state:'visible',timeout:20_000});
   await category.click();
   const kitchenDining=page.getByText('Kitchen & Dining',{exact:true});
   await kitchenDining.waitFor({state:'visible',timeout:20_000});
   await kitchenDining.click();
   const body=page.locator('body');
   await body.waitFor({state:'visible',timeout:30_000});
   const snapshotResult=await snapshot(page,{selector:'body'});
   const extracted=await body.evaluate(body=>{
    const text=node=>node.innerText.replace(/\s+/g,' ').trim();
    const categoryNames=['Kitchen & Dining','Home & Kitchen'];
    const categories=[...body.querySelectorAll('tr,[role="row"],li,section,article,button,a')].flatMap(node=>{
      const sourceText=text(node);if(!sourceText||sourceText.length>10000)return [];
      const category=categoryNames.find(name=>sourceText.includes(name));
      return category?[{category,sourceText}]:[];
    });
    const signals=[...body.querySelectorAll('tr,[role="row"],li,section,article')].flatMap(node=>{
      const sourceText=text(node);if(!sourceText||sourceText.length>10000)return [];
      const label=['Demand','Trend','Growth','Seasonality','Search Volume'].find(candidate=>new RegExp('\\b'+candidate.replace(/ /g,'\\s+')+'\\b','i').test(sourceText));
      if(!label)return [];
      const value=sourceText.replace(new RegExp('^.*?'+label.replace(/ /g,'\\s*')+'\\s*:?\\s*','i'),'').trim();
      return value?[{label,value,sourceText}]:[];
    });
    const dedupe=(items,key)=>[...new Map(items.map(item=>[key(item),item])).values()];
    const uniqueCategories=dedupe(categories,item=>item.category+'\n'+item.sourceText);
    return {categories:uniqueCategories,kitchenDiningConfirmation:'not_confirmed',signals:dedupe(signals,item=>item.label+'\n'+item.value)};
   });
   if(await destination()!==sourcePageUrl)throw Error('SOURCE_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_category_trends',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,...extracted};
  }catch{result={protocol:1,kind:'unavailable',reason:'CATEGORY_TRENDS_SOURCE_UNCONFIRMED'};}
  finally{if(page)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_CATEGORY_TRENDS_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
