import {assessMarketConcentration,marketRevenueRows,measured,unknown,type AmazonMarketObservation} from '@forge-ops/domain';
import type {ProductObservation} from '@forge-ops/integrations/jungle-scout/responses';
import type {ApiReaderContext} from './api-reader.ts';
import {collectSalesFacts} from './api-sales.ts';

export type FirstPageSource={
 readonly receiptId:string;
 readonly observation:AmazonMarketObservation;
};

export type FirstPageSales=Extract<Awaited<ReturnType<typeof collectFirstPageSales>>,{kind:'complete'}>;

export async function collectFirstPageSales(reader:ApiReaderContext,source:FirstPageSource){
 const {observation,receiptId}=source;
 if(observation.coverage!=='complete')return {kind:'unavailable' as const,reason:'FIRST_PAGE_POPULATION_INCOMPLETE'};
 const slots=observation.slots.filter(slot=>slot.adStatus==='not_marked');
 const marketAsins=[...new Set(slots.flatMap(slot=>slot.asin===null?[]:[slot.asin]))].sort();
 if(!marketAsins.length)return {kind:'unavailable' as const,reason:'FIRST_PAGE_POPULATION_EMPTY'};
 const sourceId='browser-task-result:'+receiptId;
 const products:ProductObservation[]=marketAsins.map(asin=>({
  asin:measured(asin,sourceId,observation.observedAt),
  price:unknown('FIRST_PAGE_SALES_ONLY',sourceId),
  reviews:unknown('FIRST_PAGE_SALES_ONLY',sourceId),
  category:unknown('CATEGORY_MEMBERSHIP_UNCONFIRMED',sourceId),
  catalogDimensions:unknown('CATALOG_DIMENSIONS_UNKNOWN',sourceId),
  catalogWeight:unknown('CATALOG_WEIGHT_UNKNOWN',sourceId),
  approximate30DayUnitsSold:unknown('SALES_PERIOD_INCOMPLETE',sourceId),
  approximate30DayRevenue:unknown('SALES_PERIOD_INCOMPLETE',sourceId),
  updatedAt:unknown('CATALOG_UPDATE_UNKNOWN',sourceId),
  family:{kind:'unknown',reason:'FAMILY_UNRESOLVED'},
 }));
 const result=await collectSalesFacts(reader,products,new Date(observation.observedAt));
 if(result.kind!=='complete')return result;
 const rows=marketRevenueRows(result.observations);
 const concentration=assessMarketConcentration({rows,expectedAsins:marketAsins,period:result.period,sourceId,observedAt:observation.observedAt},reader.context.snapshot);
 const {shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}=reader.context.snapshot;
 return {...result,marketReceiptId:receiptId,marketAsins,concentration,criteria:{shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}};
}
