import {
  INITIAL_SETTINGS,
  evaluateEconomics,
  type CostEvidence,
  type CostField,
  type QuoteInput,
  type SettingsSnapshot,
} from "@forge-ops/domain";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const observedAt = "2026-09-06T12:00:00.000Z";

function known(value: string): CostEvidence {
  return { value, kind: "quote", source: "supplier reply", observedAt };
}

function baseQuote(): QuoteInput {
  return {
    specId: "00000000-0000-4000-8000-000000000001",
    supplierName: "Northstar Manufacturing",
    supplierSource: "supplier email",
    sourceText: "DDP quote received from supplier",
    receivedAt: observedAt,
    validUntil: "2030-01-01",
    incoterm: "DDP",
    quantity: 300,
    moq: 100,
    risksConfirmed: true,
    riskSource: "supplier confirms packaging and lead time",
    costs: {
      salePrice: known("30"),
      productUnitPrice: known("5"),
      unitFreight: known("1"),
      unitDuty: known("0"),
      unitPrepInspection: known("0"),
      otherLandedUnitCost: known("0"),
      fbaFee: known("4.5"),
      referralFee: known("4.5"),
      adsPerUnit: known("2"),
      expectedReturnLoss: known("0.5"),
      otherVariableCost: known("0.5"),
      separateUpfrontCosts: known("200"),
      initialAdCash: known("300"),
      contingencyCash: known("300"),
    },
  };
}

function withCost(input: QuoteInput, field: CostField, value: CostEvidence): QuoteInput {
  return { ...input, costs: { ...input.costs, [field]: value } };
}

function withSettings(patch: Partial<SettingsSnapshot>): SettingsSnapshot {
  return { ...INITIAL_SETTINGS, ...patch };
}

// Given a fully evidenced supplier quote, when its costs meet the active criteria, then it is GO.
const scenarioA = evaluateEconomics(baseQuote(), INITIAL_SETTINGS);
assert(scenarioA.outcome === "GO", `A expected GO, got ${scenarioA.outcome}`);
assert(
  JSON.stringify(scenarioA.totals) ===
    JSON.stringify({
      landedUnitCost: "6",
      beforeAds: "14",
      afterAds: "12",
      marginBeforeAdsPct: "46.67",
      marginAfterAdsPct: "40",
      roiPct: "200",
      launchCash: "2600",
    }),
  `A totals mismatch: ${JSON.stringify(scenarioA.totals)}`,
);

// Given the same quote at a larger quantity, when launch cash exceeds the approved budget, then it is CAUTION.
const scenarioB = evaluateEconomics(
  withCost({ ...baseQuote(), quantity: 600 }, "productUnitPrice", known("4")),
  INITIAL_SETTINGS,
);
assert(scenarioB.outcome === "CAUTION", `B expected CAUTION, got ${scenarioB.outcome}`);
assert(scenarioB.totals?.launchCash === "3800", `B launch cash mismatch: ${scenarioB.totals?.launchCash}`);
assert(scenarioB.reasons.includes("LAUNCH_CASH_OVER_BUDGET"), "B needs budget reason");

// Given an unknown required cost, when economics are evaluated, then totals remain unavailable and HOLD.
const unknownFreight = evaluateEconomics(
  withCost(baseQuote(), "unitFreight", {
    value: null,
    kind: "unknown",
    source: null,
    observedAt: null,
    reason: "freight quote pending",
  }),
  INITIAL_SETTINGS,
);
assert(unknownFreight.outcome === "HOLD" && unknownFreight.totals === null, "unknown freight must HOLD with no totals");
assert(unknownFreight.reasons.includes("UNKNOWN_UNIT_FREIGHT"), "unknown freight reason missing");

// Given missing risk confirmation, when an otherwise complete quote is assessed, then it is HOLD.
const missingRisk = evaluateEconomics({ ...baseQuote(), risksConfirmed: false, riskSource: "" }, INITIAL_SETTINGS);
assert(missingRisk.outcome === "HOLD", "unconfirmed risk must HOLD");
assert(missingRisk.reasons.includes("RISK_UNCONFIRMED"), "risk reason missing");

// Given an expired or unstated validity date, when the quote is assessed, then it is HOLD but remains calculable only for the expired case.
const expired = evaluateEconomics({ ...baseQuote(), validUntil: "2000-01-01" }, INITIAL_SETTINGS);
assert(expired.outcome === "HOLD" && expired.reasons.includes("QUOTE_EXPIRED"), "expired quote must HOLD");
const validityUnknown = evaluateEconomics({ ...baseQuote(), validUntil: null }, INITIAL_SETTINGS);
assert(
  validityUnknown.outcome === "HOLD" && validityUnknown.reasons.includes("QUOTE_VALIDITY_UNKNOWN"),
  "missing validity must HOLD",
);

// Given invalid denominator inputs, when economics are evaluated directly, then they HOLD instead of dividing by zero or accepting negatives.
const zeroSale = evaluateEconomics(withCost(baseQuote(), "salePrice", known("0")), INITIAL_SETTINGS);
assert(zeroSale.outcome === "HOLD" && zeroSale.reasons.includes("SALE_PRICE_NOT_POSITIVE"), "zero sale must HOLD");
const zeroLanded = evaluateEconomics(
  withCost(withCost(baseQuote(), "productUnitPrice", known("0")), "unitFreight", known("0")),
  INITIAL_SETTINGS,
);
assert(zeroLanded.outcome === "HOLD" && zeroLanded.reasons.includes("LANDED_COST_NOT_POSITIVE"), "zero landed must HOLD");
const negativeCost = evaluateEconomics(withCost(baseQuote(), "productUnitPrice", known("-1")), INITIAL_SETTINGS);
assert(negativeCost.outcome === "HOLD" && negativeCost.reasons.includes("NEGATIVE_PRODUCT_UNIT_PRICE"), "negative cost must HOLD");

// Given criteria change after a quote was saved, when the current threshold rises, then the comparison is CAUTION.
const changedCriteria = evaluateEconomics(baseQuote(), withSettings({ marginAfterAdsPct: "41" }));
assert(changedCriteria.outcome === "CAUTION", "changed criteria must reclassify quote");
assert(changedCriteria.reasons.includes("MARGIN_AFTER_ADS_BELOW_CRITERIA"), "criteria reason missing");

// Given values exactly on every active threshold, when economics are evaluated, then all thresholds are inclusive.
const exactThresholds = evaluateEconomics(
  withCost(
    withCost(
      withCost(withCost(baseQuote(), "fbaFee", known("4")), "referralFee", known("4")),
      "expectedReturnLoss",
      known("0"),
    ),
    "otherVariableCost",
    known("1"),
  ),
  withSettings({
    marginBeforeAdsPct: "50",
    marginAfterAdsPct: "40",
    roiPct: "200",
    launchBudgetUsd: "2600",
  }),
);
assert(exactThresholds.outcome === "GO", `exact thresholds expected GO, got ${exactThresholds.outcome}`);

// Given an unrounded margin below the threshold, when its display rounds to the threshold, then it remains CAUTION.
const roundedThresholdMiss = evaluateEconomics(withCost(baseQuote(), "adsPerUnit", known("3.5003")), INITIAL_SETTINGS);
assert(roundedThresholdMiss.outcome === "CAUTION", "34.999% margin must not round into GO");
assert(
  roundedThresholdMiss.reasons.includes("MARGIN_AFTER_ADS_BELOW_CRITERIA"),
  "unrounded threshold reason missing",
);

// Given a known cost without provenance, when it is evaluated, then it cannot be GO.
const missingSource = evaluateEconomics(
  withCost(baseQuote(), "fbaFee", { ...known("4.5"), source: "" }),
  INITIAL_SETTINGS,
);
assert(missingSource.outcome === "HOLD", "known cost without source must HOLD");
assert(missingSource.reasons.includes("MISSING_FBA_FEE_SOURCE"), "missing source reason missing");
const missingObservedAt = evaluateEconomics(
  withCost(baseQuote(), "fbaFee", { ...known("4.5"), observedAt: "" }),
  INITIAL_SETTINGS,
);
assert(missingObservedAt.outcome === "HOLD", "known cost without observedAt must HOLD");
assert(missingObservedAt.reasons.includes("INVALID_FBA_FEE_OBSERVED_AT"), "missing observedAt reason missing");

console.log(
  JSON.stringify(
    {
      scenario: "economics",
      validA: scenarioA.outcome,
      validB: scenarioB.outcome,
      unknownFreight: unknownFreight.outcome,
      riskGate: missingRisk.outcome,
      expiryGate: expired.outcome,
      validityGate: validityUnknown.outcome,
      denominatorGates: [zeroSale.outcome, zeroLanded.outcome, negativeCost.outcome],
      criteriaChange: changedCriteria.outcome,
      exactThresholds: exactThresholds.outcome,
      roundedThresholdMiss: roundedThresholdMiss.outcome,
      provenanceGates: [missingSource.outcome, missingObservedAt.outcome],
    },
    null,
    2,
  ),
);
