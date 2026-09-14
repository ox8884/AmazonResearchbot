import { z } from "zod";

const categoryRecordSchema = z.object({
  category: z.string().trim().min(1).max(500),
  sourceText: z.string().min(1).max(10_000),
}).strict().refine(record => record.sourceText.includes(record.category), {
  message: "Category Trends source text must contain the observed category",
});

export const categoryTrendsObservationSchema = z.object({
  protocol: z.literal(1),
  kind: z.literal("captured"),
  scope: z.literal("jungle_scout_category_trends"),
  query: z.string().trim().min(1).max(500),
  sourcePageUrl: z.string().url().max(4096).regex(/^https:\/\/members\.junglescout\.com\/(?:#\/)?category-trends(?:[/?#].*)?$/),
  observedAt: z.string().datetime({ offset: true }),
  snapshot: z.string().min(1).max(1_000_000),
  categories: z.array(categoryRecordSchema).max(100),
  kitchenDiningConfirmation: z.enum(["confirmed", "not_confirmed"]),
  signals: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(2_000),
    sourceText: z.string().min(1).max(10_000),
  }).strict().refine(signal => signal.sourceText.includes(signal.label) && signal.sourceText.includes(signal.value), {
    message: "Category Trends source text must contain every observed signal",
  })).max(200),
}).strict().refine(value => value.kitchenDiningConfirmation !== "confirmed" || value.categories.some(category => category.category === "Kitchen & Dining"), {
  message: "Kitchen & Dining can only be confirmed by an observed category",
});

export type CategoryTrendsObservation = z.infer<typeof categoryTrendsObservationSchema>;
