import { z } from "zod";

const asin = z.string().regex(/^[A-Z0-9]{10}$/);
const observedValue = z.string().trim().min(1).max(2_000).nullable().optional();

export const productDatabaseObservationSchema = z.object({
  protocol: z.literal(1),
  kind: z.literal("captured"),
  scope: z.literal("jungle_scout_product_database"),
  query: z.string().trim().min(1).max(500),
  marketplace: z.literal("us").optional(),
  category: z.literal("Kitchen & Dining").optional(),
  discoveryCategory: z.literal("Home & Kitchen").optional(),
  productTier: z.literal("Standard").optional(),
  resultLimit: z.literal(100).optional(),
  displayedCount: z.number().int().positive().max(200).optional(),
  totalCount: z.number().int().positive().max(1_000_000).optional(),
  coverage: z.enum(["complete", "partial"]).optional(),
  // Set only when the capture confirmed Jungle Scout sorted the whole result set by monthly revenue.
  revenueSort: z.literal("descending").optional(),
  sourcePageUrl: z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?database(?:[/?#].*)?$/),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  records: z.array(z.object({
    asin,
    title: z.string().trim().min(1).max(2_000),
    brand: observedValue,
    categoryPath: observedValue,
    bsr: observedValue,
    unitsSoldMonthly: observedValue,
    revenueMonthly: observedValue,
    price: observedValue,
    reviews: observedValue,
    starRating: observedValue,
    sellers: observedValue,
    dimensions: observedValue,
    weight: observedValue,
    sourceText: z.string().min(1).max(30_000),
  }).strict().refine(({ sourceText, ...fields }) => Object.values(fields).every(value =>
    value === null || value === undefined || sourceText.includes(value)), {
    message: "Product Database source text must contain every reported field",
  })).min(1).max(200),
}).strict().superRefine((value, context) => {
  if (value.coverage === undefined && value.displayedCount === undefined && value.totalCount === undefined) return;
  if (value.displayedCount !== value.records.length || value.totalCount === undefined || value.coverage === undefined
    || (value.coverage === "complete") !== (value.displayedCount === value.totalCount)) {
    context.addIssue({ code: "custom", message: "Product Database coverage must match the observed result count" });
  }
});

export type ProductDatabaseObservation = z.infer<typeof productDatabaseObservationSchema>;
