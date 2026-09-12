import {randomUUID} from 'node:crypto';
import {assessMarketConcentration,evaluateNiche,measured,unknown} from '../../packages/domain/src/index.ts';

export function standaloneMarketObservations(rows){
 return rows.map(row=>({asin:row.asin,approximate30DayRevenue:row.revenue,
  family:{kind:'known',key:row.family,isVariant:measured(false,row.asin.sourceId,row.asin.observedAt),
   isParent:measured(false,row.asin.sourceId,row.asin.observedAt),variants:measured([],row.asin.sourceId,row.asin.observedAt)}}));
}

export function orderMarketFixture(settings,mode='pass'){
 if(['shareTop1MustBeBelowPct','shareTop3MustBeBelowPct','firstPageSalesMinUsd'].some(key=>typeof settings[key]!=='string'))return null;
 const receiptId=randomUUID(),sourceId='browser-task-result:'+receiptId,observedAt=new Date().toISOString();
 const endDate=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const startDate=new Date(Date.parse(endDate)-29*86400000).toISOString().slice(0,10),period={startDate,endDate};
 const marketAsins=Array.from({length:8},(_,index)=>'B0OM'+String(index).padStart(6,'0'));
 const rows=marketAsins.map((asin,index)=>({asin:measured(asin,sourceId,observedAt),family:measured(asin,sourceId,observedAt),
  revenue:mode==='unknown'&&index===0?unknown('SYNTHETIC_MISSING_SALES',sourceId):measured(mode==='caution'&&index===0?350000:50000,sourceId,observedAt)}));
 const concentration=assessMarketConcentration({rows,expectedAsins:marketAsins,period,sourceId,observedAt},settings);
 const {shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}=settings;
 return {marketReceiptId:receiptId,marketAsins,period,observations:standaloneMarketObservations(rows),concentration,criteria:{shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}};
}

export function orderValidationFixture(settings,mode='pass'){
 const at=new Date().toISOString(),fact=value=>measured(value,'synthetic-order-validation',at);
 const input={review700Count:fact(0),review2000Count:fact(0),topPriceUsd:fact('25'),monthlyRevenueCompetitorCount:fact(5),standardSize:fact(true),differentiation:fact(true)};
 return {synthetic:true,inputVersion:1,input,assessment:evaluateNiche(input,settings),firstPageSales:orderMarketFixture(settings,mode)};
}
