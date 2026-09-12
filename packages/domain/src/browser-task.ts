import { z } from "zod";
import { savedSearchFilters } from "./saved-search.ts";
import { supplierDetailProductUrlSchema, supplierDetailCompanyUrlSchema } from "./supplier-detail.ts";

export const BROWSER_TASK_SIGNATURE_PREFIX = "forge-browser-task:v1:";
export const MAX_BROWSER_TASK_BYTES = 8192;
const uuid = z.string().uuid();
export const browserTaskSchema = z.object({
  version: z.literal(1),
  id: uuid,
  issuerOrigin: z.string().url().max(2048),
  deviceId: uuid,
  issuedAt: z.string().datetime({offset:true}),
  expiresAt: z.string().datetime({offset:true}),
  request: z.discriminatedUnion("kind", [
    z.object({kind:z.literal('amazon_search'),candidateId:uuid,inputVersion:z.number().int().positive(),settingsVersion:z.number().int().positive(),query:z.string().trim().min(1).max(500)}).strict(),
    z.object({
      kind: z.literal('amazon_package'), candidateId: uuid,
      asin: z.string().regex(/^[A-Z0-9]{10}$/),
      inputVersion: z.number().int().positive(), settingsVersion: z.number().int().positive(),
    }).strict(),
    z.object({
      kind: z.literal("supplier_search"),
      candidateId: uuid,
      specId: uuid,
      inputVersion: z.number().int().positive(),
      settingsVersion: z.number().int().positive(),
      query: z.string().min(1).max(500),
    }).strict(),
    z.object({
      kind: z.literal("supplier_detail"), candidateId: uuid, specId: uuid,
      inputVersion: z.number().int().positive(), settingsVersion: z.number().int().positive(),
      sourceCaptureId: uuid, companyName: z.string().trim().min(1).max(300),
      companyUrl: supplierDetailCompanyUrlSchema,
      productUrl: supplierDetailProductUrlSchema,
    }).strict(),
    z.object({
      kind: z.literal("saved_search_export"),
      searchRunId: uuid,
      searchId: uuid,
      revision: z.number().int().positive(),
      marketplace: z.literal("us"),
      category: z.literal("Kitchen & Dining"),
      filters: savedSearchFilters,
    }).strict(),
  ]),
}).strict().refine(task => {
  const issued = Date.parse(task.issuedAt), expires = Date.parse(task.expiresAt);
  return Number.isFinite(issued) && Number.isFinite(expires) && expires > issued && expires - issued <= 300_000;
}, {message:"Browser task lifetime must be positive and at most five minutes"});
export type BrowserReadTask = z.infer<typeof browserTaskSchema>;
