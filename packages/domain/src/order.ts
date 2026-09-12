import type { CashReservation } from "./economics.ts";
import type { SettingsSnapshot } from "./settings.ts";
import type {OrderRiskReview} from './order-risk-review.ts';
import type {
  CostEvidence,
  CostField,
  EconomicsAssessment,
  QuoteRecord,
  SpecRecord,
} from "./sourcing.ts";

export const ORDER_DECISIONS = ["go", "hold", "reject"] as const;
export type OrderDecision = (typeof ORDER_DECISIONS)[number];

export type OrderSpecSnapshot = {
  readonly aiTaskId?: string;
  readonly id: string;
  readonly candidateId: string;
  readonly revision: number;
  readonly material: string;
  readonly dimensions: string;
  readonly packaging: string;
  readonly requirements: string;
  readonly requestedQuantity: number;
  readonly source: string;
  readonly createdAt: string;
};

export type OrderQuoteSnapshot = {
  readonly id: string;
  readonly candidateId: string;
  readonly specId: string;
  readonly supplierName: string;
  readonly supplierSource: string;
  readonly sourceText: string;
  readonly receivedAt: string;
  readonly validUntil: string | null;
  readonly incoterm: string;
  readonly quantity: number;
  readonly moq: number;
  readonly risksConfirmed: boolean;
  readonly riskSource: string;
  readonly costs: Readonly<Record<CostField, CostEvidence>>;
  readonly createdAt: string;
};

export type OrderSourceSnapshot = {
  readonly spec: OrderSpecSnapshot;
  readonly quote: OrderQuoteSnapshot;
};

export type OrderPacketPayload = {
  readonly payloadVersion: 1;
  readonly packetId: string;
  readonly candidateId: string;
  readonly decision: OrderDecision;
  readonly note: string;
  readonly settings: {
    readonly version: number;
    readonly snapshot: SettingsSnapshot;
  };
  readonly source: OrderSourceSnapshot;
  readonly sourceHash: string;
  readonly assessment: EconomicsAssessment;
  readonly reservation: CashReservation | null;
  readonly riskReview?: OrderRiskReview;
};

export type OrderPacketRecord = {
  readonly id: string;
  readonly candidateId: string;
  readonly quoteId: string;
  readonly specId: string;
  readonly settingsVersion: number;
  readonly decision: OrderDecision;
  readonly note: string;
  readonly state: "pending_approval" | "recorded" | "stale" | "cancelled";
  readonly approvalId: string | null;
  readonly approvalStatus: string | null;
  readonly createdAt: string;
  readonly snapshot: OrderPacketPayload;
};

export type LaunchCashReservationRecord = {
  readonly id: string;
  readonly candidateId: string;
  readonly orderPacketId: string;
  readonly approvalId: string;
  readonly rawUsd: string;
  readonly reservedUsd: string;
  readonly state: "active" | "released";
  readonly releasedAt: string | null;
  readonly releasedBy: string | null;
  readonly releaseNote: string | null;
  readonly createdAt: string;
};

export type OrderBudget = {
  readonly limitUsd: string;
  readonly reservedUsd: string;
  readonly availableUsd: string;
};

export function orderSourceSnapshot(
  spec: SpecRecord,
  quote: QuoteRecord,
): OrderSourceSnapshot {
  return {
    spec: {
      ...(spec.aiTaskId ? {aiTaskId:spec.aiTaskId} : {}),
      id: spec.id,
      candidateId: spec.candidateId,
      revision: spec.revision,
      material: spec.material,
      dimensions: spec.dimensions,
      packaging: spec.packaging,
      requirements: spec.requirements,
      requestedQuantity: spec.requestedQuantity,
      source: spec.source,
      createdAt: spec.createdAt,
    },
    quote: {
      id: quote.id,
      candidateId: quote.candidateId,
      specId: quote.specId,
      supplierName: quote.supplierName,
      supplierSource: quote.supplierSource,
      sourceText: quote.sourceText,
      receivedAt: quote.receivedAt,
      validUntil: quote.validUntil,
      incoterm: quote.incoterm,
      quantity: quote.quantity,
      moq: quote.moq,
      risksConfirmed: quote.risksConfirmed,
      riskSource: quote.riskSource,
      costs: quote.costs,
      createdAt: quote.createdAt,
    },
  };
}
