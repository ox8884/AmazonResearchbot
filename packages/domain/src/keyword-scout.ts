import { z } from "zod";

const keyword = z.string().trim().min(1).max(500);
const observedValue = z.string().trim().min(1).max(2_000).nullable().optional();

export const keywordScoutObservationSchema = z.object({
  protocol: z.literal(1),
  kind: z.literal("captured"),
  scope: z.literal("jungle_scout_keyword_scout"),
  query: keyword,
  sourcePageUrl: z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?keyword(?:[/?#].*)?$/),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  keywordRecords: z.array(z.object({
    keyword,
    searchTrend30Day: observedValue,
    exactSearchVolume30Day: observedValue,
    category: observedValue,
    ppcBidExact: observedValue,
    ppcBidBroad: observedValue,
    easeToRank: observedValue,
    relevancyScore: observedValue,
    sourceText: z.string().min(1).max(30_000),
  }).strict().refine(({ sourceText, ...fields }) => Object.values(fields).every(value =>
    value === null || value === undefined || sourceText.includes(value)), {
    message: "Keyword Scout source text must contain every reported row field",
  })).max(200).optional(),
  metrics: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(2_000),
    sourceText: z.string().min(1).max(10_000),
  }).strict().refine(metric => metric.sourceText.includes(metric.label) && metric.sourceText.includes(metric.value), {
    message: "Keyword Scout source text must contain each observed metric",
  })).max(100),
  relatedKeywords: z.array(z.object({
    keyword,
    sourceText: z.string().min(1).max(10_000),
  }).strict().refine(record => record.sourceText.includes(record.keyword), {
    message: "Keyword Scout source text must contain each related keyword",
  })).max(200),
  asinRelations: z.array(z.object({
    asin: z.string().regex(/^[A-Z0-9]{10}$/),
    sourceText: z.string().min(1).max(10_000),
  }).strict().refine(record => record.sourceText.includes(record.asin), {
    message: "Keyword Scout source text must contain each observed ASIN",
  })).max(200),
}).strict();

export type KeywordScoutObservation = z.infer<typeof keywordScoutObservationSchema>;
