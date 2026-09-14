import { z } from "zod";

const asin = z.string().regex(/^[A-Z0-9]{10}$/);

export const productDatabaseObservationSchema = z.object({
  protocol: z.literal(1),
  kind: z.literal("captured"),
  scope: z.literal("jungle_scout_product_database"),
  query: z.string().trim().min(1).max(500),
  sourcePageUrl: z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?product-database(?:[/?#].*)?$/),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  records: z.array(z.object({
    asin,
    title: z.string().trim().min(1).max(2_000),
    sourceText: z.string().min(1).max(30_000),
  }).strict().refine(record => record.sourceText.includes(record.asin) && record.sourceText.includes(record.title), {
    message: "Product Database source text must contain the observed ASIN and title",
  })).min(1).max(200),
}).strict();

export type ProductDatabaseObservation = z.infer<typeof productDatabaseObservationSchema>;
