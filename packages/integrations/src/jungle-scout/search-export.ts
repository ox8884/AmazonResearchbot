import {searchExportObservationSchema,searchLevelSchema,type BrowserReadTask} from '@forge-ops/domain';
import {parseCsv} from './csv.ts';

type SearchRequest=Extract<BrowserReadTask['request'],{kind:'saved_search_export'}>;
function numericCell(value:string|undefined,currency=false){
 const text=(value??'').trim();
 const cleaned=currency?text.replace(/^\$/,''):text;
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(cleaned))return null;
 const number=Number(cleaned.replaceAll(',',''));
 return Number.isFinite(number)?number:null;
}
function rowMatchesFilters(raw:Readonly<Record<string,string>>,filters:SearchRequest['filters']){
 if(filters.priceMinUsd!==undefined||filters.priceMaxUsd!==undefined){
  const price=numericCell(raw['Price - Monthly Avg'],true);
  if(price===null||(filters.priceMinUsd!==undefined&&price<Number(filters.priceMinUsd))||(filters.priceMaxUsd!==undefined&&price>Number(filters.priceMaxUsd)))return false;
 }
 if(filters.monthlySearchMin!==undefined){
  const searches=numericCell(raw['Search Volume - 30 Day Exact']);
  if(searches===null||!Number.isSafeInteger(searches)||searches<filters.monthlySearchMin)return false;
 }
 for(const [column,limit] of [['Competition',filters.competitionMax],['Seasonality',filters.seasonalityMax]] as const){
  if(limit===undefined)continue;
  const level=searchLevelSchema.safeParse(raw[column]);
  if(!level.success||searchLevelSchema.options.indexOf(level.data)>searchLevelSchema.options.indexOf(limit))return false;
 }
 return true;
}
export async function parseVerifiedSearchExport(input:unknown,request:SearchRequest){
 const result=searchExportObservationSchema.safeParse(input);
 if(!result.success)return null;
 const observation=result.data;
 if(observation.searchRunId!==request.searchRunId||observation.searchId!==request.searchId||observation.revision!==request.revision)return null;
 for(const key of ['priceMinUsd','priceMaxUsd','monthlySearchMin','competition','seasonality','competitionMax','seasonalityMax'] as const){
  if(observation.filters[key]!==request.filters[key])return null;
 }
 const bytes=Buffer.from(observation.csvBase64,'base64');
 if(bytes.length>2*1024*1024||bytes.toString('base64')!==observation.csvBase64)return null;
 try{
  const parsed=await parseCsv(bytes,{keyword:'Keyword'});
  if(parsed.mappedSchema!=='csv.user-mapped.junglescout-opportunity-finder.v1'||parsed.headerError!==null||parsed.validCount!==observation.records.length||parsed.rows.length!==parsed.validCount)return null;
  if(parsed.rows.some((row,index)=>row.keywordRaw!==observation.records[index]?.keyword))return null;
  if(parsed.rows.some(row=>!rowMatchesFilters(row.raw,request.filters)))return null;
  return {observation,bytes,parsed};
 }catch{return null;}
}
