import { SpecProvenance } from "./SpecProvenance.tsx";
import { QuoteCard } from "./QuoteCard.tsx";
import { NavLink } from "react-router";
import type { CandidateView } from "./api.ts";
import type {
  QuoteRecord,
  SpecRecord,
} from "../../../packages/domain/src/sourcing.ts";
import { Empty, Icon, PageHeader, useLocale } from "./ui.tsx";
export function SourcingToolbar({
  candidates,
  specs,
  candidateId,
  specId,
  editing,
  onCandidate,
  onSpec,
}: {
  readonly candidates: readonly CandidateView[];
  readonly specs: readonly SpecRecord[];
  readonly candidateId: string;
  readonly specId: string;
  readonly editing: boolean;
  readonly onCandidate: (id: string) => void;
  readonly onSpec: (id: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="sourcing-toolbar">
      <div className="field">
        <label htmlFor="quote-candidate">
          {t("비교할 후보", "Candidate to compare")}
        </label>
        <select
          id="quote-candidate"
          value={candidateId}
          disabled={editing}
          onChange={(event) => onCandidate(event.target.value)}
        >
          <option value="">
            {t("후보를 선택하세요", "Select a candidate")}
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.keyword}
            </option>
          ))}
        </select>
      </div>
      {specs.length > 0 && (
        <div className="field">
          <label htmlFor="quote-spec">
            {t("사양 버전", "Specification revision")}
          </label>
          <select
            id="quote-spec"
            value={specId}
            disabled={editing}
            onChange={(event) => onSpec(event.target.value)}
          >
            {specs.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.aiTaskId ? t("AI 제안 · ", "AI proposal · ") : ""}r{spec.revision} · {spec.material} · {spec.dimensions}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
export function SourcingSpecSummary({ spec }: { readonly spec: SpecRecord }) {
  const { t } = useLocale();
  return (
    <section className="spec-summary">
      <div className="section-label">
        <h2>
          {t("비교 사양", "Comparison specification")} · r{spec.revision}
        </h2>
        <NavLink
          className="text-btn"
          to={`/candidates/${encodeURIComponent(spec.candidateId)}`}
        >
          {t("후보 근거 보기", "View candidate evidence")}
          <Icon name="arrow" />
        </NavLink>
        <NavLink
          className="text-btn"
          to={`/candidates/${encodeURIComponent(spec.candidateId)}/orders`}
        >
          {t("발주 판단 보기", "Review order decision")}
          <Icon name="arrow" />
        </NavLink>
      </div>
      <SpecProvenance aiTaskId={spec.aiTaskId} />
      <p>
        {spec.material} · {spec.dimensions} · {spec.packaging}
      </p>
      <p className="muted">
        {spec.requirements} · <span className="spec-quantity">{t("요청 수량", "Requested quantity")} {spec.requestedQuantity}</span>
      </p>
      <details>
        <summary>{t("사양 출처 보기", "View specification source")}</summary>
        <p className="source-text">{spec.source}</p>
      </details>
    </section>
  );
}

export function SourcingActions({
  hasSpec,
  disabled,
  onQuote,
  onSpec,
}: {
  readonly hasSpec: boolean;
  readonly disabled: boolean;
  readonly onQuote: () => void;
  readonly onSpec: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="btn-row">
      {hasSpec && (
        <button
          className="btn btn-primary"
          disabled={disabled}
          onClick={onQuote}
        >
          {t("견적 기록하기", "Record a quote")}
          <Icon name="arrow" />
        </button>
      )}
      <button
        className={`btn ${hasSpec ? "btn-secondary" : "btn-primary"}`}
        onClick={onSpec}
      >
        {hasSpec
          ? t("새 사양 버전", "New specification revision")
          : t("비교 사양 만들기", "Create comparison specification")}
      </button>
    </div>
  );
}
export function SourcingQuoteResults({
  quotes,
  hasSpec,
  showEmpty,
}: {
  readonly quotes: readonly QuoteRecord[];
  readonly hasSpec: boolean;
  readonly showEmpty: boolean;
}) {
  const { t } = useLocale();
  return quotes.length ? (
    <section
      className="quote-comparison"
      aria-label={t("동일 사양 견적 비교", "Quotes for the same specification")}
    >
      {quotes.map((quote, index) => (
        <QuoteCard key={quote.id} quote={quote} index={index} />
      ))}
    </section>
  ) : showEmpty ? (
    <Empty
      icon="quote"
      title={t(
        "아직 견적이 없어요. 탈락이 아닙니다",
        "No quotes yet. This is not a rejection",
      )}
      description={t(
        hasSpec
          ? "받은 견적을 기록하면 같은 사양별로 비용과 출시 현금을 비교합니다."
          : "비교할 사양을 먼저 정한 뒤 받은 견적을 기록하세요.",
        hasSpec
          ? "Record received quotes to compare costs and launch cash."
          : "Create a specification, then record your quotes.",
      )}
    />
  ) : null;
}

export function SourcingPageHeader() {
 const {t}=useLocale();
 return (
      <PageHeader
        eyebrow="USD · Kitchen & Dining"
        title={t("견적 비교", "Quote comparison")}
        description={t(
          "같은 사양의 견적을 각각 계산합니다. 미확인 비용은 0으로 채우지 않습니다.",
          "Each quote is calculated against the same specification. Unknown costs never become zero.",
        )}
      >
        <NavLink className="text-btn" to="/inbox">
          {t("견적 회신 보기", "View quote replies")}
          <Icon name="arrow" />
        </NavLink>
      </PageHeader>
 );
}
