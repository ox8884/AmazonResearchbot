import {Decimal} from 'decimal.js';
import {estimate,measured,unknown,type Evidence} from './evidence.ts';
import {isIsoDay} from './iso-day.ts';
import type {SettingsSnapshot} from './settings.ts';
import type {ShareAssessment} from './share.ts';

const ExactDecimal=Decimal.clone({precision:40});
type MarketRevenueRow={readonly asin:Evidence<string>;readonly family:Evidence<string>;readonly revenue:Evidence<number>};
type MarketObservation={readonly asin:Evidence<string>;readonly approximate30DayRevenue:Evidence<number>;
 readonly family:{readonly kind:'unknown'}|{readonly kind:'known';readonly key:Evidence<string>;readonly isVariant:Evidence<boolean>;readonly isParent:Evidence<boolean>;readonly variants:Evidence<readonly string[]>}};
export function marketRevenueRows(observations:readonly MarketObservation[]):readonly MarketRevenueRow[]{
 return observations.map(product=>({asin:product.asin,revenue:product.approximate30DayRevenue,
  family:product.family.kind==='known'&&product.family.isVariant.kind!=='unknown'&&product.family.isParent.kind!=='unknown'&&product.family.variants.kind!=='unknown'
   ?product.family.key:unknown('FAMILY_UNRESOLVED',product.asin.sourceId)}));
}
type MarketPopulation={
 readonly rows:readonly MarketRevenueRow[];
 readonly expectedAsins:readonly string[];
 readonly period:{readonly startDate:string;readonly endDate:string}|null;
 readonly sourceId:string;
 readonly observedAt:string;
};
export type MarketConcentration={
 readonly scope:'amazon_first_page_families';
 readonly top1Pct:Evidence<string>;
 readonly top3Pct:Evidence<string>;
 readonly firstPageSalesUsd:Evidence<string>;
 readonly families:Evidence<number>;
 readonly sourceIds:readonly string[];
 readonly assessment:ShareAssessment;
};

export function assessMarketConcentration(input:MarketPopulation,settings:Pick<SettingsSnapshot,'shareTop1MustBeBelowPct'|'shareTop3MustBeBelowPct'|'firstPageSalesMinUsd'>):MarketConcentration{
 const sourceIds=[...new Set([input.sourceId,...input.rows.flatMap(row=>[row.asin.sourceId,row.family.sourceId,row.revenue.sourceId]).filter((value):value is string=>value!==null)])];
 const unavailable=(reason:string):MarketConcentration=>({scope:'amazon_first_page_families',sourceIds,
  top1Pct:unknown(reason,input.sourceId),top3Pct:unknown(reason,input.sourceId),firstPageSalesUsd:unknown(reason,input.sourceId),families:unknown(reason,input.sourceId),
  assessment:{top1:'unknown',top3:'unknown',firstPageSales:'unknown'}});
 if(!input.period||!isIsoDay(input.period.startDate)||!isIsoDay(input.period.endDate)
  ||(Date.parse(input.period.endDate)-Date.parse(input.period.startDate))/86400000+1!==30)return unavailable('SALES_PERIOD_INCOMPLETE');
 const expected=new Set(input.expectedAsins),seen=new Map<string,string>(),families=new Map<string,Decimal>();
 if(!expected.size)return unavailable('FIRST_PAGE_POPULATION_EMPTY');
 for(const row of input.rows){
  if(row.asin.kind==='unknown'||row.family.kind==='unknown'||!row.family.value||row.revenue.kind==='unknown'
   ||!expected.has(row.asin.value)||!Number.isFinite(row.revenue.value)||row.revenue.value<0)return unavailable('FIRST_PAGE_SALES_UNCONFIRMED');
  const revenue=new ExactDecimal(row.revenue.value);
  if(revenue.decimalPlaces()>2||revenue.times(100).gt(Number.MAX_SAFE_INTEGER))return unavailable('FIRST_PAGE_SALES_UNCONFIRMED');
  const previousFamily=seen.get(row.asin.value),previousRevenue=families.get(row.family.value);
  if((previousFamily!==undefined&&previousFamily!==row.family.value)||(previousRevenue!==undefined&&!previousRevenue.eq(revenue)))return unavailable('FAMILY_REVENUE_CONFLICT');
  seen.set(row.asin.value,row.family.value);families.set(row.family.value,revenue);
 }
 if(seen.size!==expected.size)return unavailable('FIRST_PAGE_POPULATION_INCOMPLETE');
 const revenues=[...families.values()].sort((a,b)=>b.cmp(a));
 const total=revenues.reduce((sum,value)=>sum.plus(value),new ExactDecimal(0));
 if(total.times(100).gt(Number.MAX_SAFE_INTEGER))return unavailable('FIRST_PAGE_SALES_UNCONFIRMED');
 const origin={sourceId:input.sourceId,observedAt:input.observedAt};
 const firstPageSalesUsd=estimate(total.toFixed(2),origin.sourceId,origin.observedAt);
 const familyCount=measured(families.size,origin.sourceId,origin.observedAt);
 const firstPageSales=total.gte(settings.firstPageSalesMinUsd)?'pass':'fail';
 if(total.isZero())return {scope:'amazon_first_page_families',sourceIds,firstPageSalesUsd,families:familyCount,
  top1Pct:unknown('ZERO_POPULATION_REVENUE',input.sourceId),top3Pct:unknown('ZERO_POPULATION_REVENUE',input.sourceId),
  assessment:{top1:'unknown',top3:'unknown',firstPageSales}};
 const top1=revenues[0];
 if(top1===undefined)return unavailable('FIRST_PAGE_POPULATION_EMPTY');
 const top3=revenues.slice(0,3).reduce((sum,value)=>sum.plus(value),new ExactDecimal(0));
 return {scope:'amazon_first_page_families',sourceIds,firstPageSalesUsd,families:familyCount,
  top1Pct:estimate(top1.times(100).div(total).toString(),origin.sourceId,origin.observedAt),
  top3Pct:estimate(top3.times(100).div(total).toString(),origin.sourceId,origin.observedAt),
  assessment:{top1:top1.times(100).lt(total.times(settings.shareTop1MustBeBelowPct))?'pass':'fail',
   top3:top3.times(100).lt(total.times(settings.shareTop3MustBeBelowPct))?'pass':'fail',firstPageSales}};
}
