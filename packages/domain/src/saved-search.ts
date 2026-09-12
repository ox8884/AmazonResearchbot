import { z } from "zod";
export const searchLevelSchema=z.enum(['Very Low','Low','Medium','High','Very High']);
const price = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/);
export const savedSearchFilters = z
  .strictObject({
    priceMinUsd: price.optional(),
    priceMaxUsd: price.optional(),
    monthlySearchMin: z.number().int().min(0).max(1000000000).optional(),
    competition: z.string().trim().min(1).max(500).optional(),
    seasonality: z.string().trim().min(1).max(500).optional(),
    competitionMax: searchLevelSchema.optional(),
    seasonalityMax: searchLevelSchema.optional(),
  })
  .refine(
    (value) =>
      value.priceMinUsd === undefined ||
      value.priceMaxUsd === undefined ||
      Number(value.priceMinUsd) <= Number(value.priceMaxUsd),
    { message: "Minimum price exceeds maximum" },
  );
export const savedSearchInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  category: z.literal("Kitchen & Dining").default("Kitchen & Dining"),
  filters: savedSearchFilters.default({}),
});
export type SavedSearchInput = z.infer<typeof savedSearchInput>;
export type SavedSearch = {
  readonly id: string;
  readonly name: string;
  readonly marketplace: string;
  readonly category: string | null;
  readonly filters: unknown;
  readonly revision: number;
};
