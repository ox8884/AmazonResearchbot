export const COST_FIELDS = [
  "salePrice",
  "productUnitPrice",
  "unitFreight",
  "unitDuty",
  "unitPrepInspection",
  "otherLandedUnitCost",
  "fbaFee",
  "referralFee",
  "adsPerUnit",
  "expectedReturnLoss",
  "otherVariableCost",
  "separateUpfrontCosts",
  "initialAdCash",
  "contingencyCash",
] as const;

export type CostField = (typeof COST_FIELDS)[number];
export type CostEvidenceKind = "measured" | "estimate" | "quote" | "unknown";
export type EconomicsBasis = Exclude<CostEvidenceKind, "unknown">;

export type KnownCostEvidence = {
  value: string;
  kind: EconomicsBasis;
  source: string;
  observedAt: string;
  reason?: string;
};

export type UnknownCostEvidence = {
  value: null;
  kind: "unknown";
  source: string | null;
  observedAt: string | null;
  reason?: string;
};

export type CostEvidence = KnownCostEvidence | UnknownCostEvidence;

export type SpecInput = {
  material: string;
  dimensions: string;
  packaging: string;
  requirements: string;
  requestedQuantity: number;
  source: string;
};

export type SpecRecord = SpecInput & {
  readonly aiTaskId?: string | null;
  id: string;
  candidateId: string;
  revision: number;
  createdAt: string;
};

export type QuoteInput = {
  specId: string;
  supplierName: string;
  supplierSource: string;
  sourceText: string;
  receivedAt: string;
  validUntil: string | null;
  incoterm: string;
  quantity: number;
  moq: number;
  risksConfirmed: boolean;
  riskSource: string;
  costs: Record<CostField, CostEvidence>;
};

export type EconomicsInput = Pick<QuoteInput, "costs" | "quantity" | "risksConfirmed" | "validUntil">;

export type EconomicsAssessment = {
  outcome: "GO" | "CAUTION" | "HOLD";
  reasons: string[];
  totals: null | {
    landedUnitCost: string;
    beforeAds: string;
    afterAds: string;
    marginBeforeAdsPct: string;
    marginAfterAdsPct: string;
    roiPct: string;
    launchCash: string;
  };
  basis: EconomicsBasis[];
};

export type QuoteRecord = QuoteInput & {
  id: string;
  candidateId: string;
  createdAt: string;
  savedSettingsVersion: number;
  settingsVersion: number;
  stale: boolean;
  assessment: EconomicsAssessment;
  savedAssessment?: EconomicsAssessment;
  sourceInboxId?: string;
};

export type SourcingView = {
  specs: SpecRecord[];
  quotes: QuoteRecord[];
  settingsVersion: number;
};
