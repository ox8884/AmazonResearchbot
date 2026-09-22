import type { ProductDatabaseObservation } from "./product-database.ts";

export const browserLeaderPendingReasons = [
  "PRODUCT_DATABASE_EMPTY",
  "RESULT_COVERAGE_UNCONFIRMED",
  "CATEGORY_UNCONFIRMED",
  "MONTHLY_REVENUE_UNCONFIRMED",
  "MONTHLY_REVENUE_AMBIGUOUS",
  "MARKET_LEADER_TIED",
] as const;

export type BrowserLeaderPendingReason = (typeof browserLeaderPendingReasons)[number];

export type BrowserProductLeader =
  | {
      readonly kind: "selected";
      readonly asin: string;
      readonly revenueText: string;
    }
  | {
      readonly kind: "pending";
      readonly reason: BrowserLeaderPendingReason;
    };

type ProductRecord = ProductDatabaseObservation["records"][number];

function parseMonthlyRevenue(value: string): number | null {
  const text = value.trim();
  if (!/^\$?(?:\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)$/.test(text)) return null;
  const amount = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function confirmsKitchenDining(categoryPath: string): boolean {
  return categoryPath.split(/\s*>\s*/).some((segment) => segment.trim().toLocaleLowerCase() === "kitchen & dining");
}

// Rows outside Kitchen & Dining or without a readable revenue are skipped, not treated as blockers;
// if nothing is eligible, the first skip reason explains why.
function selectByRevenue(records: readonly ProductRecord[]): BrowserProductLeader {
  if (records.length === 0) return { kind: "pending", reason: "PRODUCT_DATABASE_EMPTY" };

  let skipped: BrowserLeaderPendingReason | null = null;
  const revenueByAsin = new Map<string, { readonly value: number; readonly text: string }>();
  for (const record of records) {
    if (record.categoryPath === null || record.categoryPath === undefined || !confirmsKitchenDining(record.categoryPath)) {
      skipped ??= "CATEGORY_UNCONFIRMED";
      continue;
    }
    if (record.revenueMonthly === null || record.revenueMonthly === undefined) {
      skipped ??= "MONTHLY_REVENUE_UNCONFIRMED";
      continue;
    }
    const value = parseMonthlyRevenue(record.revenueMonthly);
    if (value === null) {
      skipped ??= "MONTHLY_REVENUE_AMBIGUOUS";
      continue;
    }
    const prior = revenueByAsin.get(record.asin);
    if (prior !== undefined && prior.value !== value) return { kind: "pending", reason: "MONTHLY_REVENUE_AMBIGUOUS" };
    if (prior === undefined) revenueByAsin.set(record.asin, { value, text: record.revenueMonthly });
  }

  if (revenueByAsin.size === 0) return { kind: "pending", reason: skipped ?? "PRODUCT_DATABASE_EMPTY" };

  let leaderAsin: string | null = null;
  let leader: { readonly value: number; readonly text: string } | null = null;
  let tied = false;
  for (const [asin, revenue] of revenueByAsin) {
    if (leader === null || revenue.value > leader.value) {
      leaderAsin = asin;
      leader = revenue;
      tied = false;
    } else if (revenue.value === leader.value) {
      tied = true;
    }
  }
  if (tied || leaderAsin === null || leader === null) return { kind: "pending", reason: "MARKET_LEADER_TIED" };
  return { kind: "selected", asin: leaderAsin, revenueText: leader.text };
}

export function selectBrowserProductLeader(observation: ProductDatabaseObservation): BrowserProductLeader {
  const complete = observation.coverage === "complete" && observation.displayedCount === observation.records.length &&
    observation.totalCount === observation.records.length;
  // A partial view contains the overall revenue leader only when the whole result set was sorted by revenue.
  if (!complete && (observation.revenueSort !== "descending" || observation.displayedCount !== observation.records.length)) {
    return { kind: "pending", reason: "RESULT_COVERAGE_UNCONFIRMED" };
  }
  return selectByRevenue(observation.records);
}

export type SortedViewRules = {
  readonly review700Max: number;
  readonly review2000HardFailCount: number;
  readonly revenueFloorUsd: number;
  readonly revenueCompetitorsRequired: number;
};

export type SortedViewCounts = {
  readonly review700: number | null;
  readonly review2000: number | null;
  readonly revenueCompetitors: number | null;
};

function parseCount(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^\d[\d,]*$/.test(value.trim())) return null;
  const count = Number(value.replace(/,/g, ""));
  return Number.isSafeInteger(count) ? count : null;
}

// What a revenue-sorted partial view can settle. Visible Kitchen & Dining counts are lower bounds, so they
// decide a rule only once they cross its threshold; the revenue-floor count is exact when the view ends
// below the floor, because every product above it is then visible. Anything else stays unknown (null).
export function settleSortedPartialView(observation: ProductDatabaseObservation, rules: SortedViewRules): SortedViewCounts {
  const none = { review700: null, review2000: null, revenueCompetitors: null };
  if (observation.revenueSort !== "descending" || observation.records.length === 0) return none;
  const revenues = observation.records.map((record) => typeof record.revenueMonthly === "string" ? parseMonthlyRevenue(record.revenueMonthly) : null);
  const known = revenues.filter((value): value is number => value !== null);
  if (known.some((value, index) => index > 0 && value > (known[index - 1] as number))) return none;

  const kitchen = observation.records.filter((record) => typeof record.categoryPath === "string" && confirmsKitchenDining(record.categoryPath));
  const reviews = kitchen.map((record) => parseCount(record.reviews));
  const review700 = reviews.filter((value) => value !== null && value >= 700).length;
  const review2000 = reviews.filter((value) => value !== null && value >= 2000).length;
  const barrierFailed = review700 > rules.review700Max;
  const hardFailed = review2000 >= rules.review2000HardFailCount;

  const aboveFloor = observation.records.filter((record, index) => {
    const revenue = revenues[index];
    return revenue !== null && revenue !== undefined && revenue >= rules.revenueFloorUsd &&
      typeof record.categoryPath === "string" && confirmsKitchenDining(record.categoryPath);
  }).length;
  const last = revenues[revenues.length - 1];
  const floorVisible = revenues.every((value) => value !== null) &&
    observation.records.every((record) => typeof record.categoryPath === "string") &&
    last !== null && last !== undefined && last < rules.revenueFloorUsd;

  return {
    review700: barrierFailed ? review700 : null,
    review2000: hardFailed || barrierFailed ? review2000 : null,
    revenueCompetitors: floorVisible || aboveFloor >= rules.revenueCompetitorsRequired ? aboveFloor : null,
  };
}
