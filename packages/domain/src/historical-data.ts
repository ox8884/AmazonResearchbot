import { z } from "zod";

export const historicalDataObservationSchema = z.object({
  protocol: z.literal(1),
  kind: z.literal("captured"),
  scope: z.literal("jungle_scout_historical_data"),
  query: z.string().trim().min(1).max(500),
  sourcePageUrl: z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?keyword(?:[/?#].*)?$/),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  dateRange: z.null(),
  series: z.array(z.object({
    metric: z.string().trim().min(1).max(200),
    periodLabel: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(2_000),
    sourceText: z.string().min(1).max(10_000),
  }).strict().refine(point => point.sourceText.includes(point.metric) && point.sourceText.includes(point.periodLabel) && point.sourceText.includes(point.value), {
    message: "Historical Data source text must contain every observed point",
  })).max(500),
}).strict();

export type HistoricalDataObservation = z.infer<typeof historicalDataObservationSchema>;
