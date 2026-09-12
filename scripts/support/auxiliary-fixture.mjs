export function auxiliaryFixture(url,body){
 const keyword=body?.data?.attributes?.search_terms?.[0]??url.searchParams.get('keyword');
 if(url.pathname==='/api/keywords/keywords_by_keyword_query')return {data:[{id:'us/'+keyword,type:'keywords_by_keyword_result',attributes:{country:'us',name:keyword,monthly_search_volume_exact:1200,monthly_search_volume_broad:1500,monthly_trend:-10,quarterly_trend:5,organic_product_count:100}}],links:{next:null}};
 if(url.pathname==='/api/keywords/historical_search_volume')return {data:[]};
 if(url.pathname==='/api/share_of_voice')return {data:{id:'us/'+keyword,type:'share_of_voice',attributes:{estimated_30_day_search_volume:1200,product_count:2,brands:[{brand:'Synthetic A',combined_basic_sov:0.25},{brand:'Synthetic B',combined_basic_sov:0.75}]}}};
 if(url.pathname==='/api/sales_estimates_query'){
  const asin=url.searchParams.get('asin'),start=url.searchParams.get('start_date'),end=url.searchParams.get('end_date'),data=[];
  for(let at=new Date(start+'T00:00:00Z');at.toISOString().slice(0,10)<=end;at=new Date(at.getTime()+86400000))data.push({date:at.toISOString().slice(0,10),estimated_units_sold:20,last_known_price:30});
  return {data:[{id:'us/'+asin,type:'sales_estimate_result',attributes:{asin,is_parent:false,is_variant:false,is_standalone:true,parent_asin:null,variants:[],data}}]};
 }
 return undefined;
}
