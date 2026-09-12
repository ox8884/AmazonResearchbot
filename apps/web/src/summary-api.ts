import type { DailySummaryRecord } from "../../../packages/domain/src/daily-summary.ts";
export type SummaryMeta = Omit<DailySummaryRecord, "payload">;
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Summary unavailable");
  return response.json();
}
export const listSummaries = () =>
  read<{ summaries: SummaryMeta[] }>("/api/summaries");
export const getSummary = (id: string) =>
  read<DailySummaryRecord>("/api/summaries/" + encodeURIComponent(id));
