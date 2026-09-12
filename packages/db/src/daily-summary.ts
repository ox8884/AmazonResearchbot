import type { PoolClient } from "pg";
import {
  NICHE_RULE_LABELS,
  dailySummaryPayloadSchema,
  type DailySummaryPayload,
} from "@forge-ops/domain";
import { loadCandidateDetails } from "./candidate-store.ts";
export async function buildDailySummary(
  db: PoolClient,
  now: Date,
  snapshot: Record<string, unknown>,
): Promise<DailySummaryPayload> {
  const previous = (
    await db.query<{ since: Date | null }>(
      "SELECT max(generated_at) AS since FROM daily_summaries WHERE generated_at<=$1",
      [now],
    )
  ).rows[0]?.since;
  const since = previous ?? new Date(now.getTime() - 86400000);
  const details = await loadCandidateDetails(db, "ko");
  const progress = (
    await db.query<{ candidate_id: string }>(
      "SELECT id AS candidate_id FROM candidates WHERE last_progress_at>$1 AND last_progress_at<=$2",
      [since, now],
    )
  ).rows.map((row) => row.candidate_id);
  const changed = new Set(progress);
  const candidates = details
    .map((row) => row.candidate)
    .filter(
      (row) =>
        !["rejected", "decision_recorded"].includes(row.stage) ||
        changed.has(row.id),
    );
  const rejections = details
    .filter(
      (row) =>
        row.candidate.stage === "rejected" && changed.has(row.candidate.id),
    )
    .map((row) => ({
      candidateId: row.candidate.id,
      keyword: row.candidate.keyword,
      reasons:
        row.validation.status === "reject"
          ? row.validation.rules
              .filter((rule) => rule.status === "fail")
              .map((rule) => NICHE_RULE_LABELS[rule.id][0])
          : [],
    }));
  const approvals = (
    await db.query<{ kind: string; count: number }>(
      "SELECT kind,count(*)::int AS count FROM approvals WHERE status='pending' GROUP BY kind ORDER BY kind",
    )
  ).rows;
  const utcDay = now.toISOString().slice(0, 10);
  const budget = (
    await db.query<{ reserved: number; consumed: number }>(
      "SELECT reserved,consumed FROM budget_days WHERE day_utc=$1",
      [utcDay],
    )
  ).rows[0];
  const cash = (
    await db.query<{ reserved: string }>(
      "SELECT COALESCE(sum(reserved_usd),0)::text AS reserved FROM launch_cash_reservations WHERE state='active'",
    )
  ).rows[0];
  if (!cash) throw new Error("Cash reservation total unavailable");
  const cap = snapshot.jsDailyWireCap;
  return dailySummaryPayloadSchema.parse({
    since: since.toISOString(),
    candidates,
    updatedCandidateIds: progress,
    rejections,
    approvals,
    apiBudget: {
      utcDay,
      limit:
        typeof cap === "number" && Number.isSafeInteger(cap) && cap >= 0
          ? cap
          : null,
      reserved: budget?.reserved ?? 0,
      consumed: budget?.consumed ?? 0,
      billedUsd: null,
    },
    launchCash: {
      limitUsd:
        typeof snapshot.launchBudgetUsd === "string" &&
        /^\d+(\.\d+)?$/.test(snapshot.launchBudgetUsd)
          ? snapshot.launchBudgetUsd
          : null,
      reservedUsd: cash.reserved,
      paidUsd: null,
    },
    aiCost: { reservedUsd: null, consumedUsd: null },
    delivery: "not_sent",
  });
}
