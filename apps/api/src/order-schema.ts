import { z } from "zod";
import { quoteInput, specInput } from "./quote-schema.ts";
import { settingsSnapshotSchema } from "./settings-schema.ts";
import {orderRiskReviewSchema} from '@forge-ops/domain';

const note = z.string().trim().min(1).max(4000);
const money = z.string().regex(/^\d+(?:\.\d+)?$/);
const assessment = z
  .object({
    outcome: z.enum(["GO", "CAUTION", "HOLD"]),
    reasons: z.array(z.string()),
    totals: z
      .object({
        landedUnitCost: money,
        beforeAds: z.string(),
        afterAds: z.string(),
        marginBeforeAdsPct: z.string(),
        marginAfterAdsPct: z.string(),
        roiPct: z.string(),
        launchCash: money,
      })
      .strict()
      .nullable(),
    basis: z.array(z.enum(["measured", "estimate", "quote"])),
  })
  .strict();

const source = z
  .object({
    spec: specInput
      .extend({
        aiTaskId: z.uuid().optional(),
        id: z.uuid(),
        candidateId: z.uuid(),
        revision: z.number().int().positive(),
        createdAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
    quote: quoteInput
      .extend({
        id: z.uuid(),
        candidateId: z.uuid(),
        createdAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

export const orderPacketInput = z
  .object({
    quoteId: z.uuid(),
    decision: z.enum(["go", "hold", "reject"]),
    note,
    riskReview:orderRiskReviewSchema.optional(),
  })
  .strict();

export const cancelOrderPacketInput = z.object({ note }).strict();
export const orderParams = z.object({ id: z.uuid() }).strict();

export const orderPacketPayloadSchema = z
  .object({
    payloadVersion: z.literal(1),
    packetId: z.uuid(),
    candidateId: z.uuid(),
    decision: z.enum(["go", "hold", "reject"]),
    note,
    settings: z
      .object({
        version: z.number().int().positive(),
        snapshot: settingsSnapshotSchema,
      })
      .strict(),
    source,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    assessment,
    reservation: z
      .object({ rawUsd: money, reservedUsd: money })
      .strict()
      .nullable(),
    riskReview: orderRiskReviewSchema.optional(),
  })
  .strict();
