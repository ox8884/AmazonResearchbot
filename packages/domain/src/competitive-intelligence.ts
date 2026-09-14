import { z } from "zod";

const asin = z.string().regex(/^[A-Z0-9]{10}$/);
const sourceText = z.string().min(1).max(30_000);
const competitiveSourceUrl = z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?competitive-intelligence(?:[/?#].*)?$/);
const productDatabaseSourceUrl = z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?database(?:[/?#].*)?$/);

const entitlementSchema = z.object({
  status: z.enum(["available", "upgrade_required"]),
  currentPlan: z.string().trim().min(1).max(500).nullable(),
  requiredPlan: z.string().trim().min(1).max(500).nullable(),
  sourcePageUrl: competitiveSourceUrl,
  sourceText,
}).strict().refine(value =>
  (value.currentPlan === null || value.sourceText.includes(value.currentPlan))
  && (value.requiredPlan === null || value.sourceText.includes(value.requiredPlan)), {
  message: "Competitive Intelligence entitlement must retain its observed source text",
});

const competitorSchema = z.object({
  asin,
  brand: z.string().trim().min(1).max(500).nullable(),
  categoryPath: z.string().trim().min(1).max(2_000).nullable().optional(),
  price: z.string().trim().min(1).max(500).nullable(),
  reviews: z.string().trim().min(1).max(500).nullable(),
  sales: z.string().trim().min(1).max(500).nullable(),
  revenue: z.string().trim().min(1).max(500).nullable(),
  sourceText,
}).strict().refine(record =>
  record.sourceText.includes(record.asin)
  && (record.brand === null || record.sourceText.includes(record.brand))
  && (record.categoryPath === null || record.categoryPath === undefined || record.sourceText.includes(record.categoryPath))
  && (record.price === null || record.sourceText.includes(record.price))
  && (record.reviews === null || record.sourceText.includes(record.reviews))
  && (record.sales === null || record.sourceText.includes(record.sales))
  && (record.revenue === null || record.sourceText.includes(record.revenue)), {
  message: "Competitive Intelligence source text must contain every reported field",
});

export const competitiveIntelligenceObservationSchema = z.object({
  protocol: z.literal(1),
  kind: z.literal("captured"),
  scope: z.literal("jungle_scout_competitive_intelligence"),
  query: z.string().trim().min(1).max(500),
  sourcePageUrl: z.union([competitiveSourceUrl, productDatabaseSourceUrl]),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  representativeAsin: asin.nullable(),
  representativeSelection: z.enum(["unique_revenue_leader", "ambiguous_revenue_leader", "insufficient_revenue_data"]).optional(),
  comparisonBasis: z.enum(["competitive_intelligence", "product_database"]).optional(),
  displayedCount: z.number().int().nonnegative().max(200).optional(),
  totalCount: z.number().int().nonnegative().max(1_000_000).optional(),
  coverage: z.enum(["complete", "partial"]).optional(),
  entitlement: entitlementSchema.optional(),
  competitors: z.array(competitorSchema).max(200),
}).strict().refine(value => value.representativeAsin === null || value.competitors.some(record => record.asin === value.representativeAsin), {
  message: "Representative ASIN must be one of the observed competitor records",
}).refine(value => value.sourcePageUrl.includes("#/database")
  ? value.comparisonBasis === "product_database" && value.entitlement?.status === "upgrade_required"
  : value.comparisonBasis !== "product_database", {
  message: "Product Database fallback must retain upgrade entitlement and comparison basis",
}).refine(value => value.competitors.length > 0 || value.entitlement?.status === "upgrade_required", {
  message: "An empty competitor set must retain the observed upgrade entitlement",
}).refine(value => value.representativeSelection === undefined
  || (value.representativeSelection === "unique_revenue_leader" ? value.representativeAsin !== null : value.representativeAsin === null), {
  message: "Representative selection status must agree with the observed representative ASIN",
}).refine(value => value.comparisonBasis !== "product_database" || value.coverage === undefined
  || (value.displayedCount === value.competitors.length && value.totalCount !== undefined
    && (value.coverage === "complete") === (value.displayedCount === value.totalCount)), {
  message: "Product Database fallback coverage must match the observed result count",
});

export type CompetitiveIntelligenceObservation = z.infer<typeof competitiveIntelligenceObservationSchema>;
