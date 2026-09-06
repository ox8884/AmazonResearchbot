import type { Evidence } from "./evidence.ts";
import { isKnown } from "./evidence.ts";
import type { SettingsSnapshot } from "./settings.ts";

export type RuleId =
  | "review_barrier"
  | "top_price"
  | "monthly_revenue_competitors"
  | "standard_size"
  | "differentiation";

export type RuleResult = {
  id: RuleId;
  status: "pass" | "fail" | "unknown";
  sourceId: string | null;
  detail: string;
};

export type NicheAssessment = {
  rules: RuleResult[];
  hardFail: boolean;
  outcome: "pass" | "reject" | "hold";
};

export type NicheInput = {
  review700Count: Evidence<number>;
  review2000Count: Evidence<number>;
  topPriceUsd: Evidence<string>;
  monthlyRevenueCompetitorCount: Evidence<number>;
  standardSize: Evidence<boolean>;
  differentiation: Evidence<boolean>;
};

function cmpDecimal(a: string, b: string): number {
  return Number(a) - Number(b);
}

export function evaluateNiche(input: NicheInput, settings: SettingsSnapshot): NicheAssessment {
  const rules: RuleResult[] = [];

  let hardFail = false;
  if (isKnown(input.review2000Count) && input.review2000Count.value >= settings.review2000HardFailCount) {
    hardFail = true;
    rules.push({
      id: "review_barrier",
      status: "fail",
      sourceId: input.review2000Count.sourceId,
      detail: "2000+ review products at or above hard-fail count",
    });
  } else if (!isKnown(input.review700Count) || !isKnown(input.review2000Count)) {
    rules.push({
      id: "review_barrier",
      status: "unknown",
      sourceId: input.review700Count.sourceId ?? input.review2000Count.sourceId,
      detail: "review counts not measured",
    });
  } else if (input.review700Count.value <= settings.review700Max) {
    rules.push({
      id: "review_barrier",
      status: "pass",
      sourceId: input.review700Count.sourceId,
      detail: "700+ review count within limit",
    });
  } else {
    rules.push({
      id: "review_barrier",
      status: "fail",
      sourceId: input.review700Count.sourceId,
      detail: "too many 700+ review products",
    });
  }

  if (!isKnown(input.topPriceUsd)) {
    rules.push({
      id: "top_price",
      status: "unknown",
      sourceId: input.topPriceUsd.sourceId,
      detail: input.topPriceUsd.reason,
    });
  } else {
    const v = input.topPriceUsd.value;
    const geMin = cmpDecimal(v, settings.topPriceMinUsd) >= 0;
    const leMax = cmpDecimal(v, settings.topPriceMaxUsd) <= 0;
    rules.push({
      id: "top_price",
      status: geMin && leMax ? "pass" : "fail",
      sourceId: input.topPriceUsd.sourceId,
      detail: `top price ${v} vs ${settings.topPriceMinUsd}–${settings.topPriceMaxUsd}`,
    });
  }

  if (!isKnown(input.monthlyRevenueCompetitorCount)) {
    rules.push({
      id: "monthly_revenue_competitors",
      status: "unknown",
      sourceId: input.monthlyRevenueCompetitorCount.sourceId,
      detail: input.monthlyRevenueCompetitorCount.reason,
    });
  } else {
    const ok = input.monthlyRevenueCompetitorCount.value >= settings.monthlyRevenueCompetitorCount;
    rules.push({
      id: "monthly_revenue_competitors",
      status: ok ? "pass" : "fail",
      sourceId: input.monthlyRevenueCompetitorCount.sourceId,
      detail: `${input.monthlyRevenueCompetitorCount.value} competitors at revenue floor`,
    });
  }

  if (!isKnown(input.standardSize)) {
    rules.push({
      id: "standard_size",
      status: "unknown",
      sourceId: input.standardSize.sourceId,
      detail: input.standardSize.reason,
    });
  } else {
    rules.push({
      id: "standard_size",
      status: input.standardSize.value ? "pass" : "fail",
      sourceId: input.standardSize.sourceId,
      detail: input.standardSize.value ? "standard size" : "not standard size",
    });
  }

  if (!isKnown(input.differentiation)) {
    rules.push({
      id: "differentiation",
      status: "unknown",
      sourceId: input.differentiation.sourceId,
      detail: input.differentiation.reason,
    });
  } else {
    rules.push({
      id: "differentiation",
      status: input.differentiation.value ? "pass" : "fail",
      sourceId: input.differentiation.sourceId,
      detail: input.differentiation.value ? "differentiation path present" : "no differentiation path",
    });
  }

  const pass = rules.filter((r) => r.status === "pass").length;
  const unknownCount = rules.filter((r) => r.status === "unknown").length;
  let outcome: NicheAssessment["outcome"];
  if (hardFail) outcome = "reject";
  else if (pass >= settings.passRulesRequired) outcome = "pass";
  else if (pass + unknownCount < settings.passRulesRequired) outcome = "reject";
  else outcome = "hold";

  return { rules, hardFail, outcome };
}
