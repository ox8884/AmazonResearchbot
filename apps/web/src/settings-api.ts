export type PendingSettings = {
  id: string;
  payload: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    settingsVersion: number;
  } | null;
};
export async function pendingSettings(): Promise<PendingSettings[]> {
  const response = await fetch(
    "/api/approvals?kind=budget_or_criteria_change&status=pending",
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Pending changes unavailable");
  const data: { approvals: PendingSettings[] } = await response.json();
  return data.approvals;
}
export async function rejectSettings(id: string): Promise<void> {
  const response = await fetch(
    `/api/approvals/${encodeURIComponent(id)}/reject`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw new Error("Change could not be rejected");
}
