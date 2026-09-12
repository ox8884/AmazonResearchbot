import { NavLink } from "react-router";
import type { QuoteRecord } from "../../../packages/domain/src/sourcing.ts";
import { costFields, costLabels, quoteReason, usd } from "./quote-fields.ts";
import { Icon, useLocale } from "./ui.tsx";
export function QuoteCard({
  quote,
  index,
}: {
  quote: QuoteRecord;
  index: number;
}) {
  const { t, language } = useLocale();
  const a = quote.assessment;
  const totals = a.totals;
  const kindLabel = (kind: string) =>
    kind === "quote"
      ? t("견적", "Quote")
      : kind === "measured"
        ? t("측정", "Measured")
        : kind === "estimate"
          ? t("추정", "Estimate")
          : t("미확인", "Unknown");
  const pending = t("계산 보류", "Calculation pending");
  const money = (value: string | undefined) => value === undefined ? pending : usd(value, language);
  const percent = (value: string | undefined) =>
    value === undefined
      ? pending
      : `${Number(value).toFixed(2)}%`;
  const fields = [
    [
      t("도착원가 / 개", "Landed cost / unit"),
      money(totals?.landedUnitCost),
    ],
    [
      t("광고 전 이익 / 마진", "Profit / margin before ads"),
      totals
        ? `${usd(totals.beforeAds, language)} / ${percent(totals.marginBeforeAdsPct)}`
        : pending,
    ],
    [
      t("광고 후 이익 / 마진", "Profit / margin after ads"),
      totals
        ? `${usd(totals.afterAds, language)} / ${percent(totals.marginAfterAdsPct)}`
        : pending,
    ],
    ["ROI", percent(totals?.roiPct)],
    [t("출시 현금", "Launch cash"), money(totals?.launchCash)],
  ];
  return (
    <article className="card quote-result">
      <header className="stack">
        <p className="muted">
          {t("견적", "Quote")} {index + 1} · USD
        </p>
        <div className="quote-heading">
          <h2>{quote.supplierName}</h2>
          <span
            className={`chip chip-${a.outcome === "GO" ? "ok" : a.outcome === "CAUTION" ? "warn" : "unknown"}`}
          >
            <Icon name={a.outcome === "GO" ? "check" : "unknown"} />
            {a.outcome === "HOLD" ? t("보류", "Hold") : a.outcome}
          </span>
        </div>
        <div className="chips">
          {a.basis.map((kind) => (
            <span
              className={`chip chip-${kind === "estimate" ? "warn" : kind === "quote" ? "quote" : "ok"}`}
              key={kind}
            >
              {kindLabel(kind)}
            </span>
          ))}
        </div>
        <p className="muted">
          {t(
            "지금 입력 기준 평가 · 수익성 확정 아님",
            "Assessment of current inputs · profit is not confirmed",
          )}
        </p>
      </header>
      <dl className="quote-terms">
        <div>
          <dt>{t("수량 / MOQ", "Quantity / MOQ")}</dt>
          <dd>
            {quote.quantity} / {quote.moq}
          </dd>
        </div>
        <div>
          <dt>{t("운송 조건", "Shipping terms")}</dt>
          <dd>{quote.incoterm}</dd>
        </div>
        <div>
          <dt>{t("유효일", "Valid until")}</dt>
          <dd>{quote.validUntil ?? t("미확인", "Unknown")}</dd>
        </div>
      </dl>
      <dl className="quote-metrics">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <footer className="stack">
        {quote.stale && (
          <p className="banner">
            {t(
              "저장 후 기준이 바뀌었습니다. 아래 평가는 현재 기준으로 다시 계산했습니다.",
              "Criteria changed after saving. This assessment uses the current criteria.",
            )}
          </p>
        )}
        <p className="muted">
          {t("현재 기준", "Current criteria")} v{quote.settingsVersion} ·{" "}
          {t("저장 당시", "At save")} v{quote.savedSettingsVersion}
        </p>
        {a.reasons.length > 0 && (
          <ul className="quote-reasons">
            {a.reasons.map((reason, i) => (
              <li key={`${reason}-${i}`}>{quoteReason(reason, language)}</li>
            ))}
          </ul>
        )}
        <details className="quote-evidence">
          <summary>
            {t("입력한 비용·근거 보기", "View cost inputs & evidence")}
          </summary>
          <dl className="quote-inputs">
            {costFields.map((field) => {
              const c = quote.costs[field];
              return (
                <div key={field}>
                  <dt>{t(...costLabels[field])}</dt>
                  <dd>
                    {c.kind === "unknown"
                      ? t("미확인", "Unknown")
                      : usd(c.value, language)}{" "}
                    <span className="muted">· {kindLabel(c.kind)}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="muted">
            {t("공급처 출처", "Supplier source")}: {quote.supplierSource}
          </p>
          <p className="source-text">{quote.sourceText}</p>
          {quote.sourceInboxId && (
            <NavLink
              className="text-btn"
              to={`/inbox/${encodeURIComponent(quote.sourceInboxId)}`}
            >
              {t("회신 원문 보기", "View original reply")}
            </NavLink>
          )}
          <p className="muted">
            {t("확인 시점", "Observed at")}:{" "}
            {new Date(quote.receivedAt).toLocaleString(
              language === "ko" ? "ko-KR" : "en-US",
            )}
          </p>
          <p className="source-text">
            {quote.risksConfirmed
              ? quote.riskSource
              : t(
                  "필수 위험 확인이 끝나지 않았습니다.",
                  "Required risks have not all been reviewed.",
                )}
          </p>
        </details>
      </footer>
    </article>
  );
}
