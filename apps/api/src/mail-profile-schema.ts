import { z } from "zod";
import { mailProfileWriteSchema } from "@forge-ops/domain";

export const mailProfileSaveRequestSchema = mailProfileWriteSchema;

export const mailProfileProposalRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const mailProfileDisableRequestSchema = mailProfileProposalRequestSchema;
