import { z } from "zod";
export const contactApprovalSchema = z
  .object({
    payloadVersion: z.literal(1),
    rfqId: z.uuid(),
    candidateId: z.uuid(),
    supplierId: z.uuid(),
    specId: z.uuid(),
    revision: z.number().int().positive(),
    recipient: z.email(),
    subject: z.string(),
    body: z.string(),
    quantity: z.number().int().positive(),
    settingsVersion: z.number().int().positive(),
    channel: z.literal("email"),
  })
  .strict();
