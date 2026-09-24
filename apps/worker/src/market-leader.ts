import {estimate,measured,unknown,type Evidence} from '@forge-ops/domain';
import type {ProductObservation,QueryPeriod} from '@forge-ops/integrations/jungle-scout/responses';

export type MarketLeader={readonly price:Evidence<string>;readonly family:Evidence<string>;readonly asins:Evidence<string>;readonly period:Evidence<string>};

export function selectMarketLeader(products:readonly ProductObservation[],scope:{readonly complete:boolean;readonly period:QueryPeriod|null}):MarketLeader{
 let confirmedPeriod:Evidence<string>=unknown('SALES_PERIOD_INCOMPLETE');
 const unavailable=(reason:string):MarketLeader=>({price:unknown(reason),family:unknown(reason),asins:unknown(reason),period:confirmedPeriod});
 if(!scope.complete||!scope.period||!products.length)return unavailable('MARKET_POPULATION_INCOMPLETE');
 const days=(Date.parse(scope.period.endDate)-Date.parse(scope.period.startDate))/86400000+1;
 if(days!==30)return unavailable('SALES_PERIOD_INCOMPLETE');
 const families=new Map<string,ProductObservation[]>();
 for(const product of products){
  if(product.asin.kind==='unknown'||product.category.kind==='unknown'||product.category.value!=='Kitchen & Dining'
   ||product.family.kind==='unknown'||product.family.key.kind==='unknown'||product.family.isParent.kind==='unknown'
   ||product.family.isVariant.kind==='unknown'||product.family.variants.kind==='unknown'
   ||product.approximate30DayRevenue.kind==='unknown'||!Number.isFinite(product.approximate30DayRevenue.value)||product.approximate30DayRevenue.value<0)return unavailable('MARKET_SALES_UNCONFIRMED');
  const group=families.get(product.family.key.value)??[];group.push(product);families.set(product.family.key.value,group);
 }
 const first=products[0]?.approximate30DayRevenue;
 if(first&&first.kind!=='unknown')confirmedPeriod=measured(scope.period.startDate+' ~ '+scope.period.endDate,first.sourceId,first.observedAt);
 let winningKey:string|null=null,winningRows:readonly ProductObservation[]=[],maximum=-1,tied=false;
 for(const [key,rows] of families){
  const values=new Set(rows.flatMap(row=>row.approximate30DayRevenue.kind==='unknown'?[]:[row.approximate30DayRevenue.value]));
  if(values.size!==1)return unavailable('FAMILY_REVENUE_CONFLICT');
  const revenue=[...values][0];if(revenue===undefined)return unavailable('MARKET_SALES_UNCONFIRMED');
  if(revenue>maximum){maximum=revenue;winningKey=key;winningRows=rows;tied=false;}else if(revenue===maximum)tied=true;
 }
 if(tied||maximum<=0||!winningKey)return unavailable('MARKET_LEADER_UNCONFIRMED');
 const origin=winningRows[0]?.approximate30DayRevenue;
 if(!origin||origin.kind==='unknown')return unavailable('MARKET_SALES_UNCONFIRMED');
 const asins=[...new Set(winningRows.flatMap(row=>row.asin.kind==='unknown'?[]:[row.asin.value]))].sort();
 const metadata={family:estimate(winningKey,origin.sourceId,origin.observedAt),asins:estimate(asins.join(', '),origin.sourceId,origin.observedAt),
  period:confirmedPeriod};
 const prices=new Set<string>();
 for(const row of winningRows){
  if(row.price.kind==='unknown'||!Number.isFinite(row.price.value)||row.price.value<=0||Number(row.price.value.toFixed(2))!==row.price.value)return {...metadata,price:unknown('LEADER_PRICE_UNCONFIRMED',row.price.sourceId)};
  prices.add(row.price.value.toFixed(2));
 }
 const price=[...prices][0],source=winningRows[0]?.price;
 if(prices.size!==1||price===undefined||!source||source.kind==='unknown')return {...metadata,price:unknown('LEADER_PRICE_AMBIGUOUS',origin.sourceId)};
 return {...metadata,price:estimate(price,source.sourceId,source.observedAt)};
}

// The first `limit` organic slots, in page order, that are among `eligible` products. A slot the lookup did not
// return has an unknown category, so the selection is incomplete when one appears before the limit is reached.
export function topOrganicSlots(slots:readonly {readonly asin:string|null;readonly adStatus:string}[],eligible:readonly ProductObservation[],returned:ReadonlySet<string>,limit:number){
 const byAsin=new Map(eligible.flatMap(product=>product.asin.kind==='unknown'?[]:[[product.asin.value,product] as const]));
 const seen=new Set<string>(),products:ProductObservation[]=[];let complete=true;
 for(const slot of slots){
  if(products.length>=limit)break;
  if(slot.adStatus!=='not_marked'||slot.asin===null||seen.has(slot.asin))continue;
  seen.add(slot.asin);
  const product=byAsin.get(slot.asin);
  if(product)products.push(product);else if(!returned.has(slot.asin))complete=false;
 }
 return {products,complete};
}

// Product Database estimates each variant separately. A family's first-page revenue is the sum of its listed
// variants; rows keep their own price. A family with any unknown variant revenue stays unknown.
export function withFamilyTotals(products:readonly ProductObservation[]):ProductObservation[]{
 const key=(product:ProductObservation)=>product.family.kind==='known'&&product.family.key.kind!=='unknown'?product.family.key.value:null;
 const totals=new Map<string,number|null>();
 for(const product of products){
  const family=key(product);if(family===null)continue;
  const revenue=product.approximate30DayRevenue,prior=totals.get(family);
  totals.set(family,prior===null||revenue.kind==='unknown'||!Number.isFinite(revenue.value)?null:(prior??0)+revenue.value);
 }
 return products.map(product=>{
  const family=key(product),total=family===null?undefined:totals.get(family),revenue=product.approximate30DayRevenue;
  if(total===undefined||revenue.kind==='unknown')return product;
  return {...product,approximate30DayRevenue:total===null?unknown('FAMILY_REVENUE_INCOMPLETE',revenue.sourceId):estimate(Math.round(total*100)/100,revenue.sourceId,revenue.observedAt)};
 });
}

// Leader of a first-page lookup: the family with the largest summed revenue, priced at its best-selling variant.
export function selectFirstPageLeader(products:readonly ProductObservation[],scope:{readonly complete:boolean;readonly period:QueryPeriod|null}):MarketLeader{
 const best=new Map<string,ProductObservation>();
 for(const product of products){
  if(product.family.kind!=='known'||product.family.key.kind==='unknown'||product.approximate30DayRevenue.kind==='unknown')continue;
  const prior=best.get(product.family.key.value);
  if(!prior||(prior.approximate30DayRevenue.kind!=='unknown'&&product.approximate30DayRevenue.value>prior.approximate30DayRevenue.value))best.set(product.family.key.value,product);
 }
 const totals=withFamilyTotals(products);
 const leader=selectMarketLeader(totals.map(product=>{
  const family=product.family.kind==='known'&&product.family.key.kind!=='unknown'?product.family.key.value:null;
  const top=family===null?undefined:best.get(family);
  return top?{...product,price:top.price}:product;
 }),scope);
 return leader;
}
