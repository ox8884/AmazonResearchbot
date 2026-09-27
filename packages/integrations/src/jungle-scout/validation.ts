import { estimate, isKnown, measured, unknown, type Evidence } from "@forge-ops/domain";
import type { ProductObservation } from "./responses.ts";

export type ProductDatabaseAggregation = {
  readonly review700Count: Evidence<number>;
  readonly review2000Count: Evidence<number>;
  readonly monthlyRevenueCompetitorCount: Evidence<number>;
  readonly complete: boolean;
};

export type ProductDatabaseAggregationInput = {
  readonly observations: readonly ProductObservation[];
  readonly populationComplete: boolean;
  readonly review2000HardFailCount: number;
  readonly monthlyRevenueMinUsd: string;
  // Set when the population is fully read except `missing` members whose metrics are unknown.
  readonly bounds?: { readonly missing: number; readonly review700Max: number; readonly competitorMin: number };
};

type FamilyMetrics = {
  readonly review: Evidence<number>;
  readonly revenue: Evidence<number>;
};

type EvidenceSource = { readonly sourceId: string; readonly observedAt: string } | null;

function familyMetrics(observation: ProductObservation): readonly [string, FamilyMetrics] | null {
  if (observation.family.kind !== "known" || !isKnown(observation.family.key)) return null;
  return [observation.family.key.value, {
    review: observation.reviews,
    revenue: observation.approximate30DayRevenue,
  }];
}

function productComplete(observation: ProductObservation): boolean {
  return observation.family.kind === "known" &&
    isKnown(observation.family.isParent) &&
    isKnown(observation.family.variants) &&
    isKnown(observation.asin) &&
    isKnown(observation.price) &&
    isKnown(observation.reviews) &&
    isKnown(observation.category) &&
    isKnown(observation.approximate30DayUnitsSold) &&
    isKnown(observation.approximate30DayRevenue) &&
    isKnown(observation.updatedAt);
}

function sourceFrom(metrics: readonly FamilyMetrics[]): EvidenceSource {
  for (const metric of metrics) {
    if (isKnown(metric.review)) return { sourceId: metric.review.sourceId, observedAt: metric.review.observedAt };
    if (isKnown(metric.revenue)) return { sourceId: metric.revenue.sourceId, observedAt: metric.revenue.observedAt };
  }
  return null;
}

function countEvidence(input: {
  readonly value: number;
  readonly complete: boolean;
  readonly source: EvidenceSource;
  readonly reason: string;
  readonly kind: "measured" | "estimate";
}): Evidence<number> {
  if (!input.complete || input.source === null) return unknown(input.reason, input.source?.sourceId ?? null);
  return input.kind === "measured"
    ? measured(input.value, input.source.sourceId, input.source.observedAt)
    : estimate(input.value, input.source.sourceId, input.source.observedAt);
}

export function aggregateProductDatabase(
  input: ProductDatabaseAggregationInput,
): ProductDatabaseAggregation {
  const families = new Map<string, FamilyMetrics>();
  for (const observation of input.observations) {
    const family = familyMetrics(observation);
    if (family === null) continue;
    const existing = families.get(family[0]);
    if (existing === undefined) {
      families.set(family[0], family[1]);
      continue;
    }
    const review = isKnown(existing.review) && isKnown(family[1].review) && existing.review.value >= family[1].review.value
      ? existing.review
      : family[1].review;
    const revenue = isKnown(existing.revenue) && isKnown(family[1].revenue) && existing.revenue.value >= family[1].revenue.value
      ? existing.revenue
      : family[1].revenue;
    families.set(family[0], { review, revenue });
  }

  const metrics = [...families.values()];
  const source = sourceFrom(metrics);
  const complete = input.populationComplete && input.observations.every(productComplete);
  const review700 = metrics.filter((metric) => isKnown(metric.review) && metric.review.value >= 700).length;
  const review2000 = metrics.filter((metric) => isKnown(metric.review) && metric.review.value >= 2000).length;
  const hardFailKnown = Number.isSafeInteger(input.review2000HardFailCount) && input.review2000HardFailCount > 0 &&
    review2000 >= input.review2000HardFailCount;
  const minimumRevenue = Number(input.monthlyRevenueMinUsd);
  const revenueComplete = complete && Number.isFinite(minimumRevenue) && minimumRevenue >= 0;
  const revenueCompetitors = metrics.filter((metric) => isKnown(metric.revenue) && metric.revenue.value >= minimumRevenue).length;
  // A partial population still decides a rule when the unobserved members (unreturned, or with an unknown metric),
  // counted as the worst case, cannot change the outcome. The count shown is then the observed one, as an estimate.
  const bounds = input.bounds;
  const noFamily = input.observations.filter((observation) => familyMetrics(observation) === null).length;
  const reviewGap = bounds ? bounds.missing + noFamily + metrics.filter((metric) => !isKnown(metric.review)).length : 0;
  const revenueGap = bounds ? bounds.missing + noFamily + metrics.filter((metric) => !isKnown(metric.revenue)).length : 0;
  const review700Decided = bounds !== undefined && (review700 > bounds.review700Max || review700 + reviewGap <= bounds.review700Max);
  const review2000Decided = bounds !== undefined && review2000 + reviewGap < input.review2000HardFailCount;
  const revenueDecided = bounds !== undefined && Number.isFinite(minimumRevenue) && minimumRevenue >= 0 &&
    (revenueCompetitors >= bounds.competitorMin || revenueCompetitors + revenueGap < bounds.competitorMin);

  return {
    review700Count: countEvidence({
      value: review700,
      complete: complete || review700Decided,
      source,
      reason: "REVIEW_POPULATION_INCOMPLETE",
      kind: complete ? "measured" : "estimate",
    }),
    review2000Count: countEvidence({
      value: review2000,
      complete: complete || hardFailKnown || review2000Decided,
      source,
      reason: "REVIEW_HARD_FAIL_UNKNOWN",
      kind: complete || hardFailKnown ? "measured" : "estimate",
    }),
    monthlyRevenueCompetitorCount: countEvidence({
      value: revenueCompetitors,
      complete: revenueComplete || revenueDecided,
      source,
      reason: "REVENUE_POPULATION_INCOMPLETE",
      kind: "estimate",
    }),
    complete,
  };
}
