import { z } from "zod";
import type { CostField } from "./sourcing.ts";
const text = z.string().trim().min(1).max(2000);
const timestamp = z.iso.datetime({ offset: true });
const decimal = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
const cost = z.union([
  z
    .object({
      kind: z.enum(["measured", "estimate", "quote"]),
      value: decimal,
      source: z.string().trim().min(1).max(10000),
      observedAt: timestamp,
      reason: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unknown"),
      value: z.null(),
      source: z.string().max(10000).nullable(),
      observedAt: timestamp.nullable(),
      reason: z.string().max(500).optional(),
    })
    .strict(),
]);
const costShape = {
  salePrice: cost,
  productUnitPrice: cost,
  unitFreight: cost,
  unitDuty: cost,
  unitPrepInspection: cost,
  otherLandedUnitCost: cost,
  fbaFee: cost,
  referralFee: cost,
  adsPerUnit: cost,
  expectedReturnLoss: cost,
  otherVariableCost: cost,
  separateUpfrontCosts: cost,
  initialAdCash: cost,
  contingencyCash: cost,
} satisfies Record<CostField, typeof cost>;
export const quoteInputSchema = z
  .object({
    specId: z.uuid(),
    supplierName: z.string().trim().min(1).max(200),
    supplierSource: text,
    sourceText: z.string().trim().min(1).max(10000),
    receivedAt: timestamp,
    validUntil: z.iso.date().nullable(),
    incoterm: z.string().trim().min(1).max(200),
    quantity: z.number().int().positive().max(10000000),
    moq: z.number().int().positive().max(10000000),
    risksConfirmed: z.boolean(),
    riskSource: z.string().trim().max(4000),
    costs: z.object(costShape).strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.quantity < value.moq)
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Quantity must meet MOQ",
      });
    if (value.risksConfirmed && !value.riskSource)
      ctx.addIssue({
        code: "custom",
        path: ["riskSource"],
        message: "Risk evidence is required",
      });
  });
