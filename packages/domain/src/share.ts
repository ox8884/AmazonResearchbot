import type { Evidence } from "./evidence.ts";
import { isKnown } from "./evidence.ts";

function cmpDecimal(a: string, b: string): number {
  const av = Number(a);
  const bv = Number(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

/** `< threshold` is strict. 35 vs 35 and 55 vs 55 do not pass. */
export function strictlyBelow(value: string, threshold: string): boolean {
  return cmpDecimal(value, threshold) < 0;
}

export type ShareAssessment = {
  top1: "pass" | "fail" | "unknown";
  top3: "pass" | "fail" | "unknown";
  firstPageSales: "pass" | "fail" | "unknown";
};

export function evaluateShare(
  input: {
    top1Pct: Evidence<string>;
    top3Pct: Evidence<string>;
    firstPageSalesUsd: Evidence<string>;
  },
  thresholds: { top1MustBeBelowPct: string; top3MustBeBelowPct: string; firstPageSalesMinUsd: string },
): ShareAssessment {
  return {
    top1: !isKnown(input.top1Pct)
      ? "unknown"
      : strictlyBelow(input.top1Pct.value, thresholds.top1MustBeBelowPct)
        ? "pass"
        : "fail",
    top3: !isKnown(input.top3Pct)
      ? "unknown"
      : strictlyBelow(input.top3Pct.value, thresholds.top3MustBeBelowPct)
        ? "pass"
        : "fail",
    firstPageSales: !isKnown(input.firstPageSalesUsd)
      ? "unknown"
      : cmpDecimal(input.firstPageSalesUsd.value, thresholds.firstPageSalesMinUsd) >= 0
        ? "pass"
        : "fail",
  };
}
