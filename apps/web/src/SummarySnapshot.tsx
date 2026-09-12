import { SummaryDeliveryStatus } from "./SummaryDeliveryStatus.tsx";
import { NavLink } from "react-router";
import type { DailySummaryRecord } from "../../../packages/domain/src/daily-summary.ts";
import { Stage, Unknowns, useLocale } from "./ui.tsx";
export function SummarySnapshot({ record }: { record: DailySummaryRecord }) {
  const { t, language } = useLocale();
  const payload = record.payload;
  const date = (value: string) =>
    new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
      timeZone: record.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const approvalLabels = {
    supplier_contact: t("업체 연락", "Supplier contact"),
    order_decision: t("발주 판단", "Order decisions"),
    budget_or_criteria_change: t("예산·기준 변경", "Criteria changes"),
    provider_activation: t("연결 활성화", "Connection activation"),
  };
  return (
    <>
      <section className="quiet stack">
        <h2>
          {record.localDate} · {record.timezone}
        </h2>
        <p className="muted">
          {t("집계 기간", "Period")}: {date(payload.since)} –{" "}
          {date(record.generatedAt)} · {t("기준", "Criteria")} v
          {record.settingsVersion}
        </p>
        <SummaryDeliveryStatus delivery={record.delivery} />
      </section>
      <section className="detail-section">
        <h2>{t("승인 대기", "Waiting for approval")}</h2>
        {payload.approvals.length ? (
          <ul>
            {payload.approvals.map((item) => (
              <li key={item.kind}>
                {approvalLabels[item.kind]} · {item.count}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {t(
              "생성 당시 승인 대기가 없었습니다.",
              "Nothing was awaiting approval when this was created.",
            )}
          </p>
        )}
      </section>
      <section className="detail-section">
        <h2>{t("예약과 사용", "Reservations and usage")}</h2>
        <dl className="quote-terms">
          <div>
            <dt>
              {t(
                "공식 확인 요청 · 사용 / 예약 / 한도",
                "Official checks · used / reserved / limit",
              )}
            </dt>
            <dd>
              {payload.apiBudget.consumed} / {payload.apiBudget.reserved} /{" "}
              {payload.apiBudget.limit ?? t("미확인", "Unknown")}
            </dd>
          </div>
          <div>
            <dt>{t("호출 예산 날짜 · UTC", "Call-budget day · UTC")}</dt>
            <dd>{payload.apiBudget.utcDay}</dd>
          </div>
          <div>
            <dt>{t("출시 현금 예약 (USD)", "Launch cash reserved (USD)")}</dt>
            <dd>{payload.launchCash.reservedUsd}</dd>
          </div>
          <div>
            <dt>{t("출시 현금 한도 (USD)", "Launch cash limit (USD)")}</dt>
            <dd>{payload.launchCash.limitUsd ?? t("미확인", "Unknown")}</dd>
          </div>
          <div>
            <dt>
              {t(
                "실제 API 청구·AI 비용·결제액",
                "Actual API billing, AI costs and payments",
              )}
            </dt>
            <dd>{t("미확인", "Unknown")}</dd>
          </div>
        </dl>
        <p className="muted">
          {t(
            "호출 횟수와 실제 청구 금액은 다릅니다. 확인되지 않은 비용은 0으로 계산하지 않습니다.",
            "Request counts are not billed amounts. Unconfirmed costs are not treated as zero.",
          )}
        </p>
      </section>
      <section className="detail-section">
        <h2>{t("확인된 탈락 조건", "Confirmed rejection criteria")}</h2>
        {payload.rejections.length ? (
          <ul>
            {payload.rejections.map((item) => (
              <li key={item.candidateId}>
                {item.keyword} ·{" "}
                {item.reasons.length
                  ? item.reasons.join(", ")
                  : t("근거 추가 확인 필요", "Further evidence needed")}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {t(
              "이 기간에 요약할 탈락 기록이 없습니다.",
              "No rejection records for this period.",
            )}
          </p>
        )}
      </section>
      <section className="detail-section">
        <h2>{t("후보별 기록", "Candidate snapshots")}</h2>
        <p className="muted">
          {t(
            `집계 기간에 갱신된 후보 ${payload.updatedCandidateIds.length}개. 단계 전진이나 수익성 확정을 뜻하지 않습니다.`,
            `${payload.updatedCandidateIds.length} candidates were updated in this period. Updates do not imply stage advancement or proven profitability.`,
          )}
        </p>
        {payload.candidates.map((candidate) => (
          <article className="detail-section" key={candidate.id}>
            <div className="section-label">
              <h3>{candidate.keyword}</h3>
              <Stage>{candidate.stageLabel}</Stage>
            </div>
            <p>{candidate.evidenceSummary}</p>
            <Unknowns values={candidate.unknowns} />
            <p>
              {t("당시 다음 할 일", "Next action at the time")}:{" "}
              {candidate.nextAction.label}
            </p>
            <NavLink
              className="text-btn"
              to={"/candidates/" + encodeURIComponent(candidate.id)}
            >
              {t("현재 후보 보기", "View current candidate")}
            </NavLink>
          </article>
        ))}
        {!payload.candidates.length && (
          <p>
            {t(
              "생성 당시 진행 중이거나 최근 갱신된 후보가 없었습니다.",
              "No active or recently updated candidates at creation time.",
            )}
          </p>
        )}
      </section>
    </>
  );
}
