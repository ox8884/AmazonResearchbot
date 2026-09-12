import { z } from "zod";
export const uuidParams = z.object({ id: z.uuid() });
export const supplierInput = z
  .object({
    specId: z.uuid().nullable().optional(),
    name: z.string().trim().min(1).max(200),
    email: z.email().max(320).nullable(),
    source: z.string().trim().min(1).max(10000),
    observedAt: z.iso.datetime({ offset: true }),
    matchStatus: z.enum(["matches", "mismatch", "unknown"]),
    matchNotes: z.string().trim().max(4000),
  })
  .strict()
  .refine((v) => v.matchStatus !== "matches" || v.matchNotes.length > 0, {
    message: "Matching evidence is required",
  });
export const rfqInput = z
  .object({
    aiTaskId: z.uuid().nullable().optional(),
    supplierId: z.uuid(),
    specId: z.uuid(),
    quantity: z.number().int().positive().max(10000000),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().min(1).max(30000),
  })
  .strict();
export const replyInput = z
  .object({
    source: z.string().trim().min(1).max(10000),
    receivedAt: z.iso.datetime({ offset: true }),
    messageId: z.string().trim().min(1).max(1000).nullable(),
    body: z.string().min(1).max(100000),
  })
  .strict();
export { contactApprovalSchema } from "@forge-ops/domain";

export const rfqAiQuery = z.object({specId:z.uuid(),quantity:z.coerce.number().int().positive().max(10000000)}).strict();
