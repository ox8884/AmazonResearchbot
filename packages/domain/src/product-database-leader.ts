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

function selectByRevenue(records: readonly ProductRecord[]): BrowserProductLeader {
  if (records.length === 0) return { kind: "pending", reason: "PRODUCT_DATABASE_EMPTY" };

  const revenueByAsin = new Map<string, { readonly value: number; readonly text: string }>();
  for (const record of records) {
    if (record.categoryPath === null || record.categoryPath === undefined || !confirmsKitchenDining(record.categoryPath)) {
      return { kind: "pending", reason: "CATEGORY_UNCONFIRMED" };
    }
    if (record.revenueMonthly === null || record.revenueMonthly === undefined) {
      return { kind: "pending", reason: "MONTHLY_REVENUE_UNCONFIRMED" };
    }
    const value = parseMonthlyRevenue(record.revenueMonthly);
    if (value === null) return { kind: "pending", reason: "MONTHLY_REVENUE_AMBIGUOUS" };
    const prior = revenueByAsin.get(record.asin);
    if (prior !== undefined && prior.value !== value) return { kind: "pending", reason: "MONTHLY_REVENUE_AMBIGUOUS" };
    if (prior === undefined) revenueByAsin.set(record.asin, { value, text: record.revenueMonthly });
  }

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
  if (observation.coverage !== "complete" || observation.displayedCount !== observation.records.length || observation.totalCount !== observation.records.length) {
    return { kind: "pending", reason: "RESULT_COVERAGE_UNCONFIRMED" };
  }
  return selectByRevenue(observation.records);
}
