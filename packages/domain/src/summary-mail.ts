import { z } from "zod";
import type { DailySummaryRecord } from "./daily-summary.ts";
const legacyNumericEvidencePattern =
  /(?:가격|price|리뷰|reviews?|매출|revenue|bsr|rank|수수료|fee)\D{0,24}\d/i;
export const summaryMailConsentSchema = z.object({
  summaryEmailEnabled: z.literal(true),
  summaryEmail: z.email().max(320),
});

function hasNumericEvidence(
  candidate: DailySummaryRecord["payload"]["candidates"][number],
): boolean {
  return (
    candidate.hasNumericEvidence ??
    legacyNumericEvidencePattern.test(candidate.evidenceSummary)
  );
}

function mailLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function waitingCandidateLines(
  candidates: DailySummaryRecord["payload"]["candidates"],
): string[] {
  const byAction = new Map<string, number>();
  for (const candidate of candidates) {
    const action = mailLine(candidate.nextAction.label);
    byAction.set(
      action,
      (byAction.get(action) ?? 0) + 1,
    );
  }
  return [...byAction].map(
    ([action, count]) => `${action}: ${count}개`,
  );
}

export function summaryMailContent(summary: DailySummaryRecord) {
  const p = summary.payload;
  const labels = {
    supplier_contact: "업체 연락",
    order_decision: "발주 판단",
    budget_or_criteria_change: "예산·기준 변경",
    provider_activation: "연결 활성화",
  };
  const candidatesWithEvidence = p.candidates.filter((candidate) =>
    hasNumericEvidence(candidate),
  );
  const waitingCandidates = p.candidates.filter(
    (candidate) => !hasNumericEvidence(candidate),
  );
  const candidates = candidatesWithEvidence.slice(0, 50);
  return {
    subject: `Forge Kitchen · ${summary.localDate} 아침 요약`,
    body: [
      `${summary.localDate} · ${summary.timezone} 아침 요약`,
      "생성 당시 기록입니다. 현재 상태와 승인은 앱에서 확인하세요.",
      "",
      "승인 대기",
      ...p.approvals.map((a) => `${labels[a.kind]}: ${a.count}건`),
      ...(p.approvals.length ? [] : ["생성 당시 승인 대기가 없습니다."]),
      "",
      "근거 확인 후보",
      `숫자 근거가 있는 후보 ${candidatesWithEvidence.length}개`,
      ...(candidatesWithEvidence.length ? [] : ["표시할 숫자 근거가 아직 없습니다."]),
      ...candidates.flatMap((c) => [
        `${mailLine(c.keyword)} · ${mailLine(c.stageLabel)}`,
        `근거: ${mailLine(c.evidenceSummary)}`,
        `모르는 것: ${c.unknowns.length ? c.unknowns.map(mailLine).join(" · ") : "현재 기록에 없음"}`,
        `다음 행동: ${mailLine(c.nextAction.label)}`,
        "",
      ]),
      ...(candidatesWithEvidence.length > 50
        ? [
            `근거 확인 후보 ${candidatesWithEvidence.length}개 중 50개를 표시했습니다. 나머지는 앱에서 확인하세요.`,
          ]
        : []),
      "",
      "대기 후보 (숫자 근거 없음)",
      ...(waitingCandidates.length
        ? [
            `숫자 근거가 없는 후보 ${waitingCandidates.length}개`,
            ...waitingCandidateLines(waitingCandidates),
            "개별 후보는 앱에서 확인하세요.",
          ]
        : ["현재 대기 후보가 없습니다."]),
      "",
      "탈락 기록",
      ...p.rejections.map(
        (r) =>
          `${mailLine(r.keyword)}: ${r.reasons.length ? r.reasons.map(mailLine).join(" · ") : "탈락 근거 미확인"}`,
      ),
      ...(p.rejections.length ? [] : ["집계 기간에 탈락 기록이 없습니다."]),
      "",
      "이 요약은 발주나 업체 연락을 승인하지 않습니다.",
    ].join("\n"),
  };
}
