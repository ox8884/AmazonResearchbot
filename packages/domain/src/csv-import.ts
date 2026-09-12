import { z } from 'zod';
export const CSV_FIELDS = ['keyword','reviews','review_700_count','review_2000_count','top_price','monthly_revenue_competitors','marketplace'] as const;
export type CsvField = typeof CSV_FIELDS[number];
const column = z.string().min(1).max(200).optional();
export const csvMappingSchema = z.object({
  keyword:column,reviews:column,review_700_count:column,review_2000_count:column,
  top_price:column,monthly_revenue_competitors:column,marketplace:column,
}).strict().refine(value=>new Set(Object.values(value)).size===Object.values(value).length,{message:'Each source column may be used once'});
export type CsvMapping = z.infer<typeof csvMappingSchema>;
export type CsvPreview = {
  readonly sha256:string; readonly headers:readonly string[]; readonly mapping:CsvMapping;
  readonly validCount:number; readonly totalRows:number; readonly headerError:string|null;
  readonly samples:readonly {rowNumber:number;raw:Readonly<Record<string,string>>;values:Partial<Record<CsvField,string>>;error:string|null}[];
  readonly issues:readonly {rowNumber:number;error:string}[];
};
