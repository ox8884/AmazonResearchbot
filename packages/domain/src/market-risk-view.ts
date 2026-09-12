import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {isIsoDay} from './iso-day.ts';
import type {SettingsSnapshot} from './settings.ts';
import {assessMarketConcentration,marketRevenueRows} from './market-concentration.ts';
const unknownValue=z.object({kind:z.literal('unknown'),value:z.null(),sourceId:z.string().nullable(),observedAt:z.string().nullable(),reason:z.string()});
const decimal=z.string().regex(/^\d+(?:\.\d+)?$/).refine(value=>Number.isFinite(Number(value)));
const evidence=<T extends z.ZodType>(value:T)=>z.union([unknownValue,z.object({kind:z.enum(['measured','estimate','quote']),value,sourceId:z.string().min(1),observedAt:z.iso.datetime({offset:true})})]);
const status=z.enum(['pass','fail','unknown']);
const asin=z.string().regex(/^[A-Z0-9]{10}$/);
const observation=z.object({asin:evidence(asin),approximate30DayRevenue:evidence(z.number()),
 family:z.discriminatedUnion('kind',[z.object({kind:z.literal('unknown')}),z.object({kind:z.literal('known'),key:evidence(asin),
  isVariant:evidence(z.boolean()),isParent:evidence(z.boolean()),variants:evidence(z.array(asin).readonly())})])});
const pageSchema=z.object({
 marketReceiptId:z.uuid(),marketAsins:z.array(z.string().regex(/^[A-Z0-9]{10}$/)).min(1).max(200),
 observations:z.array(observation).min(1).max(200),
 period:z.object({startDate:z.string().refine(isIsoDay),endDate:z.string().refine(isIsoDay)}),
 criteria:z.object({shareTop1MustBeBelowPct:decimal,shareTop3MustBeBelowPct:decimal,firstPageSalesMinUsd:decimal}),
 concentration:z.object({scope:z.literal('amazon_first_page_families'),
  top1Pct:evidence(decimal.refine(value=>Number(value)<=100)),top3Pct:evidence(decimal.refine(value=>Number(value)<=100)),
  firstPageSalesUsd:evidence(decimal),families:evidence(z.number().int().nonnegative().max(200)),
  assessment:z.object({top1:status,top3:status,firstPageSales:status}),
 }),
}).refine(page=>(Date.parse(page.period.endDate)-Date.parse(page.period.startDate))/86400000+1===30)
 .refine(page=>new Set(page.marketAsins).size===page.marketAsins.length)
 .refine(page=>[page.concentration.top1Pct,page.concentration.top3Pct,page.concentration.firstPageSalesUsd,page.concentration.families]
  .every(value=>value.kind==='unknown'||value.sourceId==='browser-task-result:'+page.marketReceiptId))
 .refine(page=>page.observations.every(row=>row.asin.kind==='unknown'||row.asin.sourceId==='browser-task-result:'+page.marketReceiptId));
export type MarketRiskView=Pick<z.infer<typeof pageSchema>,'period'|'criteria'|'concentration'>&{readonly asinCount:number};
export function readMarketRiskView(payload:unknown):MarketRiskView|null{
 const envelope=z.object({firstPageSales:z.unknown()}).safeParse(payload);
 const parsed=pageSchema.safeParse(envelope.success?envelope.data.firstPageSales:null);
 if(!parsed.success)return null;
 const {period,criteria,concentration,marketAsins,observations}=parsed.data;
 const origin=observations[0]?.asin;
 if(!origin||origin.kind==='unknown')return null;
 const computed=assessMarketConcentration({rows:marketRevenueRows(observations),expectedAsins:marketAsins,period,
  sourceId:'browser-task-result:'+parsed.data.marketReceiptId,observedAt:origin.observedAt},criteria);
 for(const key of ['top1Pct','top3Pct','firstPageSalesUsd','families'] as const){
  const recorded=concentration[key],expected=computed[key];
  if(recorded.kind==='unknown'||expected.kind==='unknown'){if(recorded.kind!==expected.kind)return null;}
  else if(recorded.kind!==expected.kind||recorded.observedAt!==origin.observedAt||!new Decimal(recorded.value).eq(expected.value))return null;
 }
 if((['top1','top3','firstPageSales'] as const).some(key=>concentration.assessment[key]!==computed.assessment[key]))return null;
 return {period,criteria,concentration,asinCount:marketAsins.length};
}

export function marketRiskOutcome(risk:MarketRiskView|null|undefined):'GO'|'CAUTION'|'HOLD'{
 if(!risk)return 'HOLD';
 const c=risk.concentration,states=Object.values(c.assessment);
 if([c.top1Pct,c.top3Pct,c.firstPageSalesUsd,c.families].some(value=>value.kind==='unknown')||states.includes('unknown'))return 'HOLD';
 return states.includes('fail')?'CAUTION':'GO';
}

export function marketRiskMatchesSettings(risk:MarketRiskView,settings:Pick<SettingsSnapshot,'shareTop1MustBeBelowPct'|'shareTop3MustBeBelowPct'|'firstPageSalesMinUsd'>):boolean{
 return (['shareTop1MustBeBelowPct','shareTop3MustBeBelowPct','firstPageSalesMinUsd'] as const).every(key=>risk.criteria[key]===settings[key]);
}
