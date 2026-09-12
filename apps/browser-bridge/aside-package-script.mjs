import {readAmazonProductEvidence} from './aside-product-evidence.mjs';

export function amazonPackageScript(asin,marker) {
 async function collect(asin,marker,readProduct) {
  let p,result;
  try {
   if(typeof asin!=='string'||!/^[A-Z0-9]{10}$/.test(asin))throw Error('INVALID_ASIN');
   p=await openTab('https://www.amazon.com/dp/'+asin);
   const checkPage=()=>{
    const base=p.url().split(/[?#]/,1)[0];
    const current=/^https:\/\/www\.amazon\.com\/(?:[A-Za-z0-9_-]+\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/(?:ref=[A-Za-z0-9_=.-]+)?)?$/.exec(base)?.[1];
    if(current!==asin)throw Error('PRODUCT_CHANGED');
   };
   const selectors=['#productDetails_feature_div','#detailBullets_feature_div','#detailBulletsWrapper_feature_div','#prodDetails'];
   let selector=selectors[0];
   for(const candidate of selectors){try{if(await p.locator(candidate).count()>0){selector=candidate;break;}}catch{}}
   checkPage();await p.locator(selector).waitFor({state:'visible',timeout:15000});
   const read=()=>p.locator(selector).evaluate(root=>{
    const clean=value=>(value??'').replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/\s+/g,' ').trim();
    const rows=[],asins=[];
    for(const element of root.querySelectorAll('table tr, li')){
     const cells=Array.from(element.children).filter(cell=>cell.tagName==='TH'||cell.tagName==='TD');
     const text=clean(element.innerText);
     const label=cells.length===2?clean(cells[0].innerText):clean((/^(Package Dimensions|Package Weight|Item Weight|Item Dimensions[^:]*|Product Dimensions):/.exec(text)?.[1])??'');
     const value=cells.length===2?clean(cells[1].innerText):clean(text.replace(new RegExp('^'+label+'\\s*:\\s*'),'').replace(new RegExp('^'+label+'\\s+'),'').trim());
     if(!label||!value)continue;
     if(label==='ASIN')asins.push(value);
     if(!/^(?:ASIN|Package Dimensions|Package Weight|Item Weight|(?:Item|Product) Dimensions.*)$/.test(label))continue;
     if(element.getClientRects().length===0||getComputedStyle(element).visibility==='hidden')continue;
     const excerpt=clean(element.innerText);
     if(!label||!value||label.length>100||value.length>2000||excerpt!==label+' '+value)throw Error('ROW_UNCONFIRMED');
     rows.push({label,value,excerpt});
    }
    return {rows,asins};
   });
   const rows=[],snapshots=[];
   for(const name of ['Item details','Measurements']){
    const button=p.getByRole('button',{name,exact:true});
    await button.waitFor({state:'visible',timeout:15000});
    const state=await button.evaluate(el=>el.getAttribute('aria-expanded'));
    if(state==='false')await button.press('Enter');else if(state!=='true')throw Error('EXPANSION_UNCONFIRMED');
    if(await button.evaluate(el=>el.getAttribute('aria-expanded'))!=='true')throw Error('EXPANSION_UNCONFIRMED');
    const view=await snapshot(p,{selector});
    if(!view.tree||view.tree.length>100000)throw Error('SNAPSHOT_UNCONFIRMED');
    snapshots.push(view.tree);checkPage();
    const captured=await read();
    if(!captured.asins.length||captured.asins.some(value=>value!==asin))throw Error('PRODUCT_CHANGED');
    for(const row of captured.rows)if(!rows.some(prior=>prior.label===row.label&&prior.value===row.value))rows.push(row);
   }
   checkPage();
   const final=await read();
   if(!final.asins.length||final.asins.some(value=>value!==asin)||!rows.some(row=>row.label==='ASIN'&&row.value===asin)||rows.length>100)throw Error('IDENTITY_UNCONFIRMED');
   const pageText=rows.map(row=>row.excerpt).join('\n');
   if(pageText.length>100000)throw Error('SOURCE_TOO_LARGE');
   const productEvidence=await p.locator('body').evaluate(readProduct);
   checkPage();
   result={protocol:1,kind:'captured',scope:'amazon_product_page',asin,sourcePageUrl:p.url(),observedAt:new Date().toISOString(),snapshot:snapshots.join('\n'),pageText,rows,productEvidence};
  }catch{result={protocol:1,kind:'unavailable',reason:'ASIDE_SITE_OR_LAYOUT_UNAVAILABLE'};}
  finally{if(p)await closeTab(p);}
  console.log(marker+JSON.stringify(result));
 }
 return 'await ('+collect.toString()+')('+JSON.stringify(asin)+','+JSON.stringify(marker)+','+readAmazonProductEvidence.toString()+')';
}
