import { z } from "zod";
export { quoteInputSchema as quoteInput } from "@forge-ops/domain";
const text = z.string().trim().min(1).max(2000);
export const candidateParams = z.object({ id: z.uuid() });
export const specInput = z
  .object({
    material: text,
    dimensions: text,
    packaging: text,
    requirements: text,
    requestedQuantity: z.number().int().positive().max(10000000),
    source: text,
  })
  .strict();
