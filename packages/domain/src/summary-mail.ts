import { z } from "zod";
import type { DailySummaryRecord } from "./daily-summary.ts";
export const summaryMailConsentSchema = z.object({
  summaryEmailEnabled: z.literal(true),
  summaryEmail: z.email().max(320),
});
export function summaryMailContent(summary: DailySummaryRecord) {
  const p = summary.payload;
  const labels = {
    supplier_contact: "업체 연락",
    order_decision: "발주 판단",
    budget_or_criteria_change: "예산·기준 변경",
    provider_activation: "연결 활성화",
  };
  const candidates = p.candidates.slice(0, 50);
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
      "후보 진행",
      ...candidates.flatMap((c) => [
        `${c.keyword} · ${c.stageLabel}`,
        `근거: ${c.evidenceSummary}`,
        `모르는 것: ${c.unknowns.length ? c.unknowns.join(" · ") : "현재 기록에 없음"}`,
        `다음 행동: ${c.nextAction.label}`,
        "",
      ]),
      ...(p.candidates.length > 50
        ? [
            `후보 ${p.candidates.length}개 중 50개를 표시했습니다. 나머지는 앱에서 확인하세요.`,
          ]
        : []),
      "탈락 기록",
      ...p.rejections.map(
        (r) =>
          `${r.keyword}: ${r.reasons.length ? r.reasons.join(" · ") : "탈락 근거 미확인"}`,
      ),
      ...(p.rejections.length ? [] : ["집계 기간에 탈락 기록이 없습니다."]),
      "",
      "이 요약은 발주나 업체 연락을 승인하지 않습니다.",
    ].join("\n"),
  };
}
