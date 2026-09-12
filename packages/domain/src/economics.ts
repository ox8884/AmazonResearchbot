import { Decimal } from "decimal.js";
import type { SettingsSnapshot } from "./settings.ts";
import {
  COST_FIELDS,
  type CostEvidence,
  type CostField,
  type EconomicsAssessment,
  type EconomicsBasis,
  type EconomicsInput,
} from "./sourcing.ts";

type CostRead =
  | { kind: "known"; values: Map<CostField, Decimal>; basis: EconomicsBasis[] }
  | { kind: "hold"; reasons: string[]; basis: EconomicsBasis[] };

type Values = {
  salePrice: Decimal;
  productUnitPrice: Decimal;
  unitFreight: Decimal;
  unitDuty: Decimal;
  unitPrepInspection: Decimal;
  otherLandedUnitCost: Decimal;
  fbaFee: Decimal;
  referralFee: Decimal;
  adsPerUnit: Decimal;
  expectedReturnLoss: Decimal;
  otherVariableCost: Decimal;
  separateUpfrontCosts: Decimal;
  initialAdCash: Decimal;
  contingencyCash: Decimal;
};

type Calculation = {
  totals: NonNullable<EconomicsAssessment["totals"]>;
  marginBeforeAdsPct: Decimal;
  marginAfterAdsPct: Decimal;
  roiPct: Decimal;
  launchCash: Decimal;
};

export type CashReservation = {
  rawUsd: string;
  reservedUsd: string;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected cost evidence kind: ${String(value)}`);
}

function fieldCode(field: CostField): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

function formatMoney(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2).replace(/(?:\.0+|(?<decimal>\.\d*?)0+)$/, "$<decimal>");
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function readCosts(costs: Record<CostField, CostEvidence>): CostRead {
  const values = new Map<CostField, Decimal>();
  const reasons: string[] = [];
  const basis: EconomicsBasis[] = [];
  for (const field of COST_FIELDS) {
    const evidence = costs[field];
    switch (evidence.kind) {
      case "unknown":
        reasons.push(`UNKNOWN_${fieldCode(field)}`);
        break;
      case "measured":
      case "estimate":
      case "quote": {
        if (evidence.source.trim() === "") {
          reasons.push(`MISSING_${fieldCode(field)}_SOURCE`);
          break;
        }
        if (!isIsoTimestamp(evidence.observedAt)) {
          reasons.push(`INVALID_${fieldCode(field)}_OBSERVED_AT`);
          break;
        }
        try {
          const value = new Decimal(evidence.value);
          if (!value.isFinite()) reasons.push(`INVALID_${fieldCode(field)}`);
          else if (value.isNegative()) reasons.push(`NEGATIVE_${fieldCode(field)}`);
          else {
            values.set(field, value);
            if (!basis.includes(evidence.kind)) basis.push(evidence.kind);
          }
        } catch {
          reasons.push(`INVALID_${fieldCode(field)}`);
        }
        break;
      }
      default:
        assertNever(evidence);
    }
  }
  return reasons.length === 0 ? { kind: "known", values, basis } : { kind: "hold", reasons, basis };
}

function readValues(values: Map<CostField, Decimal>): Values | null {
  const salePrice = values.get("salePrice");
  const productUnitPrice = values.get("productUnitPrice");
  const unitFreight = values.get("unitFreight");
  const unitDuty = values.get("unitDuty");
  const unitPrepInspection = values.get("unitPrepInspection");
  const otherLandedUnitCost = values.get("otherLandedUnitCost");
  const fbaFee = values.get("fbaFee");
  const referralFee = values.get("referralFee");
  const adsPerUnit = values.get("adsPerUnit");
  const expectedReturnLoss = values.get("expectedReturnLoss");
  const otherVariableCost = values.get("otherVariableCost");
  const separateUpfrontCosts = values.get("separateUpfrontCosts");
  const initialAdCash = values.get("initialAdCash");
  const contingencyCash = values.get("contingencyCash");
  if (
    salePrice === undefined ||
    productUnitPrice === undefined ||
    unitFreight === undefined ||
    unitDuty === undefined ||
    unitPrepInspection === undefined ||
    otherLandedUnitCost === undefined ||
    fbaFee === undefined ||
    referralFee === undefined ||
    adsPerUnit === undefined ||
    expectedReturnLoss === undefined ||
    otherVariableCost === undefined ||
    separateUpfrontCosts === undefined ||
    initialAdCash === undefined ||
    contingencyCash === undefined
  ) {
    return null;
  }
  return {
    salePrice,
    productUnitPrice,
    unitFreight,
    unitDuty,
    unitPrepInspection,
    otherLandedUnitCost,
    fbaFee,
    referralFee,
    adsPerUnit,
    expectedReturnLoss,
    otherVariableCost,
    separateUpfrontCosts,
    initialAdCash,
    contingencyCash,
  };
}

function hold(reasons: string[], basis: EconomicsBasis[], totals: EconomicsAssessment["totals"] = null): EconomicsAssessment {
  return { outcome: "HOLD", reasons, totals, basis };
}

function calculate(values: Values, quantity: number): Calculation | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || values.salePrice.lte(0)) return null;
  const landedUnitCost = values.productUnitPrice
    .plus(values.unitFreight)
    .plus(values.unitDuty)
    .plus(values.unitPrepInspection)
    .plus(values.otherLandedUnitCost);
  if (landedUnitCost.lte(0)) return null;
  const beforeAds = values.salePrice
    .minus(landedUnitCost)
    .minus(values.fbaFee)
    .minus(values.referralFee)
    .minus(values.expectedReturnLoss)
    .minus(values.otherVariableCost);
  const afterAds = beforeAds.minus(values.adsPerUnit);
  const marginBeforeAdsPct = beforeAds.div(values.salePrice).mul(100);
  const marginAfterAdsPct = afterAds.div(values.salePrice).mul(100);
  const roiPct = afterAds.div(landedUnitCost).mul(100);
  const launchCash = landedUnitCost
    .mul(quantity)
    .plus(values.separateUpfrontCosts)
    .plus(values.initialAdCash)
    .plus(values.contingencyCash);
  return {
    totals: {
      landedUnitCost: formatMoney(landedUnitCost),
      beforeAds: formatMoney(beforeAds),
      afterAds: formatMoney(afterAds),
      marginBeforeAdsPct: formatMoney(marginBeforeAdsPct),
      marginAfterAdsPct: formatMoney(marginAfterAdsPct),
      roiPct: formatMoney(roiPct),
      launchCash: formatMoney(launchCash),
    },
    marginBeforeAdsPct,
    marginAfterAdsPct,
    roiPct,
    launchCash,
  };
}

export function reserveCash(input: EconomicsInput): CashReservation | null {
  const read = readCosts(input.costs);
  if (read.kind === "hold") return null;
  const values = readValues(read.values);
  if (denominatorReason(values, input.quantity) || values === null) return null;
  const calculation = calculate(values, input.quantity);
  if (calculation === null) return null;
  return {
    rawUsd: calculation.launchCash.toFixed(),
    reservedUsd: calculation.launchCash
      .toDecimalPlaces(2, Decimal.ROUND_CEIL)
      .toFixed(2),
  };
}

function denominatorReason(values: Values | null, quantity: number): string | null {
  if (values === null || !Number.isSafeInteger(quantity) || quantity <= 0) return "INVALID_QUANTITY";
  if (values.salePrice.lte(0)) return "SALE_PRICE_NOT_POSITIVE";
  const landedUnitCost = values.productUnitPrice
    .plus(values.unitFreight)
    .plus(values.unitDuty)
    .plus(values.unitPrepInspection)
    .plus(values.otherLandedUnitCost);
  return landedUnitCost.lte(0) ? "LANDED_COST_NOT_POSITIVE" : null;
}

export function evaluateEconomics(input: EconomicsInput, settings: SettingsSnapshot): EconomicsAssessment {
  const read = readCosts(input.costs);
  if (read.kind === "hold") return hold(read.reasons, read.basis);
  const values = readValues(read.values);
  const invalid = denominatorReason(values, input.quantity);
  if (invalid) return hold([invalid], read.basis);
  if (values === null) return hold(["CALCULATION_UNAVAILABLE"], read.basis);
  const calculation = calculate(values, input.quantity);
  if (calculation === null) return hold(["CALCULATION_UNAVAILABLE"], read.basis);

  const gates: string[] = [];
  if (!input.risksConfirmed) gates.push("RISK_UNCONFIRMED");
  if (input.validUntil === null) gates.push("QUOTE_VALIDITY_UNKNOWN");
  else if (input.validUntil < new Date().toISOString().slice(0, 10)) gates.push("QUOTE_EXPIRED");
  if (gates.length > 0) return hold(gates, read.basis, calculation.totals);

  const reasons: string[] = [];
  if (calculation.marginBeforeAdsPct.lt(settings.marginBeforeAdsPct)) reasons.push("MARGIN_BEFORE_ADS_BELOW_CRITERIA");
  if (calculation.marginAfterAdsPct.lt(settings.marginAfterAdsPct)) reasons.push("MARGIN_AFTER_ADS_BELOW_CRITERIA");
  if (calculation.roiPct.lt(settings.roiPct)) reasons.push("ROI_BELOW_CRITERIA");
  if (calculation.launchCash.gt(settings.launchBudgetUsd)) reasons.push("LAUNCH_CASH_OVER_BUDGET");
  return { outcome: reasons.length === 0 ? "GO" : "CAUTION", reasons, totals: calculation.totals, basis: read.basis };
}
