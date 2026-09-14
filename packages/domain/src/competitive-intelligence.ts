import { z } from "zod";

const asin = z.string().regex(/^[A-Z0-9]{10}$/);
const sourceText = z.string().min(1).max(30_000);

const competitorSchema = z.object({
  asin,
  brand: z.string().trim().min(1).max(500).nullable(),
  price: z.string().trim().min(1).max(500).nullable(),
  reviews: z.string().trim().min(1).max(500).nullable(),
  sales: z.string().trim().min(1).max(500).nullable(),
  revenue: z.string().trim().min(1).max(500).nullable(),
  sourceText,
}).strict().refine(record =>
  record.sourceText.includes(record.asin)
  && (record.brand === null || record.sourceText.includes(record.brand))
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
  sourcePageUrl: z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?competitive-intelligence(?:[/?#].*)?$/),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  representativeAsin: asin.nullable(),
  competitors: z.array(competitorSchema).min(1).max(200),
}).strict().refine(value => value.representativeAsin === null || value.competitors.some(record => record.asin === value.representativeAsin), {
  message: "Representative ASIN must be one of the observed competitor records",
});

export type CompetitiveIntelligenceObservation = z.infer<typeof competitiveIntelligenceObservationSchema>;
