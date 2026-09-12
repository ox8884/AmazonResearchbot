import {z} from 'zod';
import {savedSearchFilters,searchLevelSchema} from './saved-search.ts';

export const searchRunSnapshotSchema=z.object({
 id:z.string().uuid(),revision:z.number().int().positive(),name:z.string(),
 category:z.literal('Kitchen & Dining'),marketplace:z.literal('us'),filters:savedSearchFilters,
}).strict();
const inputs=z.tuple([z.string(),z.string(),z.string(),z.string(),z.string(),z.string()]);
const range=z.tuple([z.literal('Very Low'),searchLevelSchema]);
export const searchExportObservationSchema=z.object({
 protocol:z.literal(1),kind:z.literal('captured'),scope:z.literal('opportunity_finder_export'),
 sourcePageUrl:z.literal('https://members.junglescout.com/#/opportunity-finder'),
 observedAt:z.string().datetime({offset:true}),searchRunId:z.string().uuid(),searchId:z.string().uuid(),revision:z.number().int().positive(),
 marketplace:z.literal('us'),discoveryCategory:z.literal('Home & Kitchen'),filters:savedSearchFilters,
 applied:z.object({lower:inputs,upper:inputs,competition:range,seasonality:range}).strict(),
 records:z.array(z.object({keyword:z.string().min(1).max(500),dominantCategory:z.literal('Home & Kitchen')}).strict()).min(1).max(200),
 totalResults:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),page:z.literal(1),
 filename:z.string().max(240).regex(/^Jungle Scout Opportunity Finder CSV Export - [^/\\]+\.csv$/),
 csvBase64:z.string().min(4).max(2796204).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
 snapshot:z.string().min(1).max(1000000),
}).strict().refine(value=>{
 const {filters,applied}=value;
 if(filters.competition!==undefined||filters.seasonality!==undefined)return false;
 const lower=['',filters.priceMinUsd??'',filters.monthlySearchMin===undefined?'':String(filters.monthlySearchMin),'','',''];
 const upper=['',filters.priceMaxUsd??'','','','',''];
 return JSON.stringify(applied.lower)===JSON.stringify(lower)&&JSON.stringify(applied.upper)===JSON.stringify(upper)&&
  applied.competition[1]===(filters.competitionMax??'Very High')&&applied.seasonality[1]===(filters.seasonalityMax??'Very High')&&
  value.totalResults>=value.records.length&&new Set(value.records.map(row=>row.keyword)).size===value.records.length&&
  value.records.every(row=>value.snapshot.includes(row.keyword));
},{message:'Export must match the observed filter and result scope'});
export type SearchExportObservation=z.infer<typeof searchExportObservationSchema>;
