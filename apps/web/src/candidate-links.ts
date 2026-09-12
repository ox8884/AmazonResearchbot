import type { CandidateView } from "./api.ts";

export function candidateApprovalPath(
  candidate: Pick<CandidateView, "id" | "nextAction">,
): string | null {
  if (candidate.nextAction.kind !== "approval") return null;
  const base = `/candidates/${encodeURIComponent(candidate.id)}`;
  switch (candidate.nextAction.target) {
    case "supplier_contact":
      return `${base}/contact`;
    case "order_decision":
      return `${base}/orders`;
    default:
      return null;
  }
}
