export function categoryTrendsScript(query,marker,representativeAsin=null){
 async function collect(query,marker,representativeAsin){
  function extractCategorySnapshot(tree){
   const lines=String(tree||'').split(/\r?\n/);
   const decode=line=>{const offset=line.indexOf('text: ');if(offset<0)return null;try{return JSON.parse(line.slice(offset+6).trim());}catch{return null;}};
   const datePattern=/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/g;
   const dateLine=lines.find(line=>{const value=decode(line);return value!==null&&[...value.matchAll(datePattern)].length>=4;});
   const dateLabels=dateLine?[...decode(dateLine).matchAll(datePattern)].map(match=>match[0]):[];
   const categoryLine=lines.find(line=>{const value=decode(line);return value!==null&&value.trim()==='Kitchen & Dining';});
   const categories=categoryLine?[{category:'Kitchen & Dining',sourceText:decode(categoryLine)}]:[];
   const products=[];let group=-1,lastRank=null;
   for(let index=0;index<lines.length;index+=1){
    const first=decode(lines[index]);
    const imageMatch=lines[index].match(/image\s+"([A-Z0-9]{10})"/);
    const nextText=decode(lines[index+1]??'');
    const match=first?.match(/^([A-Z0-9]{10})#(\d+)\s+(.+)$/)??(imageMatch&&nextText?.match(/^#(\d+)\s+(.+)$/)?[nextText,imageMatch[1],nextText.match(/^#(\d+)\s+(.+)$/)[1],nextText.match(/^#(\d+)\s+(.+)$/)[2]]:null);
    if(!match)continue;
    const asin=imageMatch?match[1]:match[1];
    const rank=imageMatch?match[2]:match[2];
    const productName=imageMatch?match[3]:match[3];
    if(rank==='1'&&lastRank!==null)group+=1;
    if(lastRank===null)group=0;
    lastRank=rank;
    let details=null;
    for(let detailIndex=index+1;detailIndex<Math.min(index+12,lines.length);detailIndex+=1){
     const value=decode(lines[detailIndex]);
     if(!value)continue;
     if(/^[A-Z0-9]{10}#\d+\s/.test(value))break;
     if(/^\d+(?:\.\d+)?\([^)]*\)\|.+$/.test(value)){details=value;break;}
    }
    const detailMatch=details?.match(/^([0-9]+(?:\.[0-9]+)?)\(([^)]*)\)\|(.+)$/);
    const rating=detailMatch?.[1]??null,reviews=detailMatch?.[2]??null,price=detailMatch?.[3]??null;
    const dateLabel=dateLabels[group]??null;
    const sourceText=[dateLabel,asin+'#'+rank,productName,details].filter(Boolean).join(' ');
    products.push({asin,rank,productName,rating,reviews,price,dateLabel,sourceText});
   }
   const uniqueProducts=[...new Map(products.map(product=>[(product.dateLabel??'unknown')+'\n'+product.asin,product])).values()];
   const dateColumns=dateLabels.map(dateLabel=>({dateLabel,sourceText:[dateLabel,...uniqueProducts.filter(product=>product.dateLabel===dateLabel).map(product=>product.sourceText)].join('\n'),products:uniqueProducts.filter(product=>product.dateLabel===dateLabel)})).filter(column=>column.products.length);
   const representativeHistory=representativeAsin===null?[]:uniqueProducts.filter(product=>product.asin===representativeAsin&&product.dateLabel!==null);
   return {categories,kitchenDiningConfirmation:categories.length?'confirmed':'not_confirmed',products:uniqueProducts,dateColumns,representativeHistory};
  }
  let page,result,owned=false,stage='OPEN';
  try{
   const existing=(await listBrowserTabs()).find(tab=>typeof tab.targetId==='string'&&typeof tab.url==='string'&&/^https:\/\/members\.junglescout\.com\//.test(tab.url));
   if(existing)page=await attachBrowserTab(existing.targetId);
   else {page=await openTab('https://members.junglescout.com/#/category-trends');owned=true;}
   stage='NAVIGATION';
   const destination=()=>page.evaluate(()=>location.href);
   const categoryUrl='https://members.junglescout.com/#/category-trends';
   if(await destination()!==categoryUrl){
    try{await page.goto(categoryUrl);}catch(error){if(await destination()!==categoryUrl)throw error;}
   }
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?category-trends(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   stage='CATEGORY';
   const category=page.getByRole('combobox').nth(1);
   await category.waitFor({state:'visible',timeout:20_000});
   await category.click();
   const kitchenDining=page.getByText('Kitchen & Dining',{exact:true});
   await kitchenDining.waitFor({state:'visible',timeout:20_000});
   await kitchenDining.click();
   stage='RESULT_SNAPSHOT';
   const snapshotResult=await snapshot(page,{selector:'body'});
   stage='RESULT_EXTRACTION';
   const extracted=extractCategorySnapshot(snapshotResult.tree);
   if(!extracted.products.length||!extracted.dateColumns.length)throw Error('RESULT_SCOPE_UNCONFIRMED');
   if(await destination()!==sourcePageUrl)throw Error('SOURCE_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_category_trends',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,representativeAsin:representativeAsin??null,categories:extracted.categories,kitchenDiningConfirmation:extracted.kitchenDiningConfirmation,signals:[],unavailableSignals:['demand','seasonality','growth'],products:extracted.products,dateColumns:extracted.dateColumns,representativeHistory:extracted.representativeHistory};
  }catch(error){
   const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'CATEGORY_TRENDS_'+stage+'_UNCONFIRMED';
   result={protocol:1,kind:'unavailable',reason};
  }
  finally{if(page&&owned)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_CATEGORY_TRENDS_QUERY');
 if(representativeAsin!==null&&(!/^[A-Z0-9]{10}$/.test(representativeAsin)))throw Error('INVALID_CATEGORY_TRENDS_ASIN');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+','+JSON.stringify(representativeAsin)+')';
}
