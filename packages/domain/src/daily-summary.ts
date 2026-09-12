import { z } from "zod";
import { STAGES, BLOCKED_REASONS } from "./stages.ts";
const count = z.number().int().nonnegative();
const candidate = z.object({
  id: z.uuid(),
  keyword: z.string(),
  stage: z.enum(STAGES),
  stageLabel: z.string(),
  evidenceSummary: z.string(),
  unknowns: z.array(z.string()),
  blockedReason: z.enum(BLOCKED_REASONS).nullable(),
  nextAction: z.object({
    kind: z.enum(["automatic", "approval", "waiting"]),
    label: z.string(),
    target: z.string(),
  }),
});
export const dailySummaryPayloadSchema = z.object({
  since: z.iso.datetime({ offset: true }),
  candidates: z.array(candidate),
  updatedCandidateIds: z.array(z.uuid()),
  rejections: z.array(
    z.object({
      candidateId: z.uuid(),
      keyword: z.string(),
      reasons: z.array(z.string()),
    }),
  ),
  approvals: z.array(
    z.object({
      kind: z.enum([
        "supplier_contact",
        "order_decision",
        "budget_or_criteria_change",
        "provider_activation",
      ]),
      count,
    }),
  ),
  apiBudget: z.object({
    utcDay: z.iso.date(),
    limit: count.nullable(),
    reserved: count,
    consumed: count,
    billedUsd: z.null(),
  }),
  launchCash: z.object({
    limitUsd: z.string().nullable(),
    reservedUsd: z.string(),
    paidUsd: z.null(),
  }),
  aiCost: z.object({ reservedUsd: z.null(), consumedUsd: z.null() }),
  delivery: z.literal("not_sent"),
});
export type DailySummaryPayload = z.infer<typeof dailySummaryPayloadSchema>;
export type SummaryDeliveryView = {
  state: "pending" | "dispatching" | "sent" | "unknown" | "blocked" | "cancelled";
  recipient: string;
  attemptCount: number;
  reason: string | null;
  finishedAt: string | null;
  localCapture: boolean;
};
export type DailySummaryRecord = {
  readonly delivery?: SummaryDeliveryView | null;
  readonly id: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly settingsVersion: number;
  readonly generatedAt: string;
  readonly payload: DailySummaryPayload;
};
