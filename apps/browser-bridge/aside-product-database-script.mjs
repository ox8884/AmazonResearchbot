export function productDatabaseScript(query,marker){
 async function collect(query,marker){
  let page,result;
  try{
   page=await openTab('https://members.junglescout.com/');
   const productLink=page.getByRole('link',{name:'Product Database',exact:true});
   await productLink.waitFor({state:'visible',timeout:20_000});
   await productLink.click();
   const destination=()=>page.evaluate(()=>location.href);
   const sourcePageUrl=await destination();
   if(!/^https:\/\/members\.junglescout\.com\/(?:#\/)?database(?:[/?#].*)?$/.test(sourcePageUrl))throw Error('SITE_CHANGED');
   const input=page.getByRole('textbox',{name:'Enter words and/or ASINs separated by commas',exact:true});
   await input.waitFor({state:'visible',timeout:20_000});
   await input.fill(query);
   if(await input.evaluate(el=>el.value)!==query)throw Error('QUERY_NOT_APPLIED');
   await page.getByRole('button',{name:'Search',exact:true}).click();
   const table=page.getByRole('table',{name:'Product Database Table',exact:true});
   await table.waitFor({state:'visible',timeout:30_000});
   const snapshotResult=await snapshot(page,{selector:'[role="table"]'});
   const records=await table.evaluate(table=>[...table.querySelectorAll('[role="row"]')].slice(1).flatMap(row=>{
    if(row.getClientRects().length===0||getComputedStyle(row).visibility!=='visible')return [];
    const sourceText=row.innerText.replace(/\s+/g,' ').trim();
    const asin=/\b[A-Z0-9]{10}\b/.exec(sourceText)?.[0];
    const cells=[...row.querySelectorAll('[role="cell"]')].map(cell=>cell.innerText.replace(/\s+/g,' ').trim());
    const title=cells[1]?.replace(/\s*\b[A-Z0-9]{10}\b\s*$/,'').trim()??'';
    return asin&&title&&sourceText.includes(asin)&&sourceText.includes(title)?[{asin,title,sourceText}]:[];
   }));
   if(!records.length||records.length>200||new Set(records.map(record=>record.asin)).size!==records.length)throw Error('RESULT_SCOPE_UNCONFIRMED');
   if(await input.evaluate(el=>el.value)!==query||await destination()!==sourcePageUrl)throw Error('QUERY_CHANGED');
   result={protocol:1,kind:'captured',scope:'jungle_scout_product_database',query,sourcePageUrl,observedAt:new Date().toISOString(),snapshot:snapshotResult.tree,records};
  }catch{result={protocol:1,kind:'unavailable',reason:'PRODUCT_DATABASE_SOURCE_UNCONFIRMED'};}
  finally{if(page)await closeTab(page);}
  console.log(marker+JSON.stringify(result));
 }
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('INVALID_PRODUCT_DATABASE_QUERY');
 return 'await ('+collect.toString()+')('+JSON.stringify(query)+','+JSON.stringify(marker)+')';
}
