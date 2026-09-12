import {unknown,type Evidence,type KnownKind} from './evidence.ts';
import type {NicheInput} from './niche.ts';
export type StoredEvidence = {
  readonly field:string;readonly kind:string;
  readonly value_text:string|null;readonly value_numeric:string|number|null;
  readonly source_id:string|null;readonly observed_at:Date|string|null;readonly reason:string|null;
};
function storedValue(row:StoredEvidence|undefined):Evidence<string> {
  if(!row||row.kind==='unknown')return unknown(row?.reason??'missing',row?.source_id??null);
  const value=row.value_text??row.value_numeric;
  if(value===null||String(value).trim()==='')return unknown('empty',row.source_id);
  if(!row.source_id||!row.observed_at)return unknown('Source provenance is missing',row.source_id);
  const observed=new Date(row.observed_at);
  if(!Number.isFinite(observed.getTime()))return unknown('Source date is invalid',row.source_id);
  const kind:KnownKind|null=row.kind==='measured'||row.kind==='estimate'||row.kind==='quote'?row.kind:null;
  if(!kind)return unknown('Evidence type is invalid',row.source_id);
  return {kind,value:String(value),sourceId:row.source_id,observedAt:observed.toISOString()};
}
function count(row:StoredEvidence|undefined):Evidence<number> {
  const parsed=storedValue(row);if(parsed.kind==='unknown')return parsed;
  const value=Number(parsed.value);
  return /^\d+(?:\.0+)?$/.test(parsed.value)&&Number.isSafeInteger(value)&&value>=0
    ? {...parsed,value}:unknown('count_not_integer',parsed.sourceId);
}
function price(row:StoredEvidence|undefined):Evidence<string> {
  const parsed=storedValue(row);if(parsed.kind==='unknown')return parsed;
  return /^\d+(?:\.\d+)?$/.test(parsed.value)&&Number.isFinite(Number(parsed.value))
    ? parsed:unknown('number_out_of_range',parsed.sourceId);
}
function boolean(row:StoredEvidence|undefined):Evidence<boolean> {
  const parsed=storedValue(row);if(parsed.kind==='unknown')return parsed;
  if(parsed.value==='true'||parsed.value==='1')return {...parsed,value:true};
  if(parsed.value==='false'||parsed.value==='0')return {...parsed,value:false};
  return unknown('Boolean evidence is not confirmed',parsed.sourceId);
}
/** Rows must contain the latest stored observation first for each field. */
export function readNicheEvidence(rows:readonly StoredEvidence[]):NicheInput {
  const field=(name:string)=>rows.find(row=>row.field===name);
  return {
    review700Count:count(field('review_700_count')),
    review2000Count:count(field('review_2000_count')),
    topPriceUsd:price(field('top_price')),
    monthlyRevenueCompetitorCount:count(field('monthly_revenue_competitors')),
    standardSize:boolean(field('standard_size')),
    differentiation:boolean(field('differentiation')),
  };
}
