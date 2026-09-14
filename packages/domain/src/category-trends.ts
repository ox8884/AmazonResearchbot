import { z } from "zod";

const categoryRecordSchema = z.object({
  category: z.string().trim().min(1).max(500),
  sourceText: z.string().min(1).max(10_000),
}).strict().refine(record => record.sourceText.includes(record.category), {
  message: "Category Trends source text must contain the observed category",
});

const observedValue = z.string().trim().min(1).max(2_000).nullable().optional();
const productSchema = z.object({
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  rank: observedValue,
  productName: observedValue,
  rating: observedValue,
  reviews: observedValue,
  price: observedValue,
  dateLabel: observedValue,
  sourceText: z.string().min(1).max(30_000),
}).strict().refine(({ sourceText, ...fields }) => Object.values(fields).every(value =>
  value === null || value === undefined || sourceText.includes(value)), {
  message: "Category Trends source text must contain every reported product field",
});

const dateColumnSchema = z.object({
  dateLabel: z.string().trim().min(1).max(200),
  sourceText: z.string().min(1).max(50_000),
  products: z.array(productSchema).max(100),
}).strict().refine(column => column.sourceText.includes(column.dateLabel), {
  message: "Category Trends date column source text must contain its date label",
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
  products: z.array(productSchema).max(400).optional(),
  dateColumns: z.array(dateColumnSchema).max(31).optional(),
}).strict().refine(value => value.kitchenDiningConfirmation !== "confirmed" || value.categories.some(category => category.category === "Kitchen & Dining"), {
  message: "Kitchen & Dining can only be confirmed by an observed category",
});

export type CategoryTrendsObservation = z.infer<typeof categoryTrendsObservationSchema>;
