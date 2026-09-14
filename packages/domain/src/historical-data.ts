import { z } from "zod";

const dateRangeSchema = z.object({
  label: z.string().trim().min(1).max(200),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
}).strict().refine(range => Date.parse(range.end) >= Date.parse(range.start), {
  message: "Historical Data range must not end before it starts",
});

export const historicalDataObservationSchema = z.object({
  protocol: z.literal(1),
  kind: z.literal("captured"),
  scope: z.literal("jungle_scout_historical_data"),
  query: z.string().trim().min(1).max(500),
  sourcePageUrl: z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?historical-data(?:[/?#].*)?$/),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  dateRange: dateRangeSchema.nullable(),
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
