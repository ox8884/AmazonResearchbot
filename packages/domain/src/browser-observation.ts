import { z } from "zod";
import { supplierDetailObservationSchema } from "./supplier-detail.ts";
import { supplierCaptureSchema } from "./supplier-capture.ts";
import { amazonPackageObservationSchema } from './amazon-package.ts';
import { searchExportObservationSchema } from './search-export.ts';
import {amazonMarketObservationSchema} from './amazon-market.ts';
const urls=supplierCaptureSchema.shape;
export const supplierSearchObservationSchema=z.object({
 protocol:z.literal(1),kind:z.literal("captured"),scope:z.literal("first_results_page"),
 sourcePageUrl:z.string().url().max(4096).regex(/^https:\/\/www\.alibaba\.com\/[^#]*$/),
 query:z.string().min(1).max(500),observedAt:z.string().datetime({offset:true}),
 snapshot:z.string().min(1).max(2000000),visibleCards:z.number().int().nonnegative(),
 records:z.array(z.object({
  companyName:z.string().trim().min(1).max(300),companyUrl:urls.companyUrl,
  productName:z.string().trim().min(1).max(2000),productUrl:urls.productUrl,
  pageText:z.string().min(1).max(100000),
 }).strict().refine(row=>row.pageText.includes(row.companyName)&&row.pageText.includes(row.productName),{message:"Source text must contain the observed names"})).min(1).max(200),
}).strict().refine(value=>value.visibleCards>=value.records.length,{message:"Invalid visible record count"});

export const browserObservationSchema=z.union([supplierSearchObservationSchema,supplierDetailObservationSchema,amazonPackageObservationSchema,searchExportObservationSchema,amazonMarketObservationSchema]);
