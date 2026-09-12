import type { Evidence } from "./api.ts";
import { fieldLabel, unknownLabel } from "./evidence.ts";
import { useLocale } from "./ui.tsx";
export function EvidenceList({ items }: { items: readonly Evidence[] }) {
  const { t, language } = useLocale();
  return (
    <div className="evidence-list">
      {items.map((e, i) => {
        const observed =
          e.field.startsWith("api_") &&
          e.observed_at &&
          Number.isFinite(Date.parse(e.observed_at))
            ? new Date(e.observed_at).toISOString().slice(0, 10)
            : null;
        return (
          <div className="evidence-row" key={`${e.field}-${i}`}>
            <div>
              <span>
                {fieldLabel(e.field, language)}:{" "}
                {e.kind === "unknown"
                  ? unknownLabel(e.reason ?? t("미확인", "Unknown"), language)
                  : e.field==='api_market_leader_period'&&e.value_text&&/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/.test(e.value_text)
                    ? <span className="evidence-date-range">{e.value_text}</span>
                  : (e.value_numeric ?? e.value_text ?? t("미확인", "Unknown"))}
              </span>
              {observed && (
                <span className="muted">
                  {t("확인일", "Observed")}: {observed} UTC
                </span>
              )}
            </div>
            <span
              className={`chip chip-${e.kind === "measured" ? "ok" : e.kind === "estimate" ? "warn" : e.kind === "quote" ? "quote" : "unknown"}`}
            >
              {e.kind === "measured"
                ? t("측정", "Measured")
                : e.kind === "estimate"
                  ? t("추정", "Estimated")
                  : e.kind === "quote"
                    ? t("견적", "Quoted")
                    : t("미확인", "Unknown")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
export function OfficialEvidence({ items }: { items: readonly Evidence[] }) {
  const { t } = useLocale();
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) =>
    Number(b.field.startsWith('api_market_leader_'))-Number(a.field.startsWith('api_market_leader_')) || a.field
      .replace(/^(api_sales_[^:]+):(.+)$/, "$2:$1")
      .localeCompare(
        b.field.replace(/^(api_sales_[^:]+):(.+)$/, "$2:$1"),
        "en",
      ),
  );
  return (
    <details className="official-evidence">
      <summary>
        {t("추가 공식 자료", "Additional official evidence")} · {items.length}
        {t("개 항목", " fields")}
      </summary>
      <p className="muted">
        {t(
          "검색 추이는 응답에 포함된 구간만 보여줍니다. 노출 점유율은 매출 점유율이나 첫 페이지 매출이 아닙니다.",
          "Search history covers returned intervals only. Exposure share is not revenue share or first-page revenue.",
        )}
      </p>
      {items.some(item=>item.field.startsWith("api_catalog_")) && <p className="muted">{t("카탈로그 치수·무게는 등록된 값입니다.", "Catalog dimensions and weight are listed values.")}<br />{t("후보의 Standard 규격 판정은 아닙니다.", "They are not a Standard-size decision for this candidate.")}</p>}
      {items.some(item=>item.field.startsWith('api_market_leader_'))&&<p className="muted">{t('매출 1위 가격은 상품 DB 전체 조회 결과와 같은 30일 매출 추정으로 판단합니다. 상품군 중복을 제외하며 공동 1위나 가격 차이는 미확인으로 남깁니다.','Leader pricing uses the full Product Database query and aligned 30-day sales estimates. Families are deduplicated; ties and differing prices remain unconfirmed.')}</p>}
      <EvidenceList items={sorted} />
    </details>
  );
}
