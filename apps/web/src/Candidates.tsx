import { candidateApprovalPath } from "./candidate-links.ts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router";
import { listCandidates, type CandidateView } from "./api.ts";
import { loadMarket, type MarketView } from "./MarketSource.tsx";
import { evidenceText, unknownLabel } from "./evidence.ts";
import { contactReason } from "./contact-labels.ts";
import {
  Empty,
  Icon,
  LoadError,
  Loading,
  PageHeader,
  Stage,
  Unknowns,
  useLocale,
} from "./ui.tsx";

const decisionMeta = {
  go: { label: ["GO", "GO"] as const, className: "chip-ok", icon: "check" as const },
  caution: { label: ["주의", "CAUTION"] as const, className: "chip-warn", icon: "warning" as const },
  no_go: { label: ["No-Go", "NO-GO"] as const, className: "chip-danger", icon: "warning" as const },
  waiting: { label: ["대기", "WAITING"] as const, className: "chip-unknown", icon: "clock" as const },
} as const;
const decisionFilters = ["go", "caution", "no_go", "waiting"] as const;

export function useCandidates() {
  const { language } = useLocale();
  return useQuery({
    queryKey: ["candidates", language],
    queryFn: () => listCandidates(language),
    refetchInterval: 10000,
  });
}
export function CandidateCard({
  candidate: c,
  selected,
  onSelect,
}: {
  candidate: CandidateView;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { t, language } = useLocale();
  const market = useQuery({
    queryKey: ["market-source", c.id],
    queryFn: () => loadMarket(c.id),
    retry: false,
    refetchInterval: 10000,
  });
  const approvalPath = candidateApprovalPath(c);
  const captured = market.data?.state === "captured" ? market.data : null;
  const first = captured?.slots[0];
  const firstPrice = first
    ? first.price.kind === "unknown"
      ? first.priceTexts[0] ?? t("가격 미확인", "Price unknown")
      : `$${first.price.value}`
    : t("가격 미확인", "Price unknown");
  const blockedReason = c.blockedReason
    ? contactReason(c.blockedReason, language)
    : null;
  const unknownValues = c.unknowns.filter(
    (value) => value !== "지금 모르는 것은 없습니다" && value !== "None right now",
  );
  const decision = decisionMeta[c.decision];
  return (
    <article className={`card candidate-card${selected ? " selected" : ""}`}>
      <div className="chips candidate-statuses">
        <span className={`chip ${decision.className}`}>
          <Icon name={decision.icon} />
          {decision.label[language === "ko" ? 0 : 1]}
        </span>
        <Stage>{c.stageLabel}</Stage>
        {blockedReason && (
          <span className="chip chip-warn">
            <Icon name="warning" />
            {t("막힘 이유", "Blocked because")}: {blockedReason}
          </span>
        )}
      </div>
      <h3>
        <NavLink className="keyword-link" to={`/candidates/${c.id}`}>
          {c.keyword}
        </NavLink>
      </h3>
      <p>{evidenceText(c.evidenceSummary, language)}</p>
      {captured && first && (
        <div className="market-observation">
          <span className="muted">{t("Amazon 첫 페이지 관측", "Amazon first-page observation")}</span>
          <strong>{captured.slots.length}{t("개 항목", " observed items")} · {firstPrice}</strong>
          <p className="muted">{first.title ?? t("첫 상품명 미확인", "First title unknown")}</p>
        </div>
      )}
      <div className="unknown-summary">
        <span className="muted">{t("모르는 것", "Unknown")}</span>
        <Unknowns values={c.unknowns} />
      </div>
      {unknownValues.length > 0 && (
        <details className="unknowns-checklist">
          <summary>
            <span>
              {t(
                `확인할 항목 ${unknownValues.length}개`,
                `${unknownValues.length} items to verify`,
              )}
            </span>
            <span className="muted">
              {t("판정에 필요한 근거", "Evidence needed for a decision")}
            </span>
          </summary>
          <ul>
            {unknownValues.map((value) => (
              <li key={value}>
                <Icon name="unknown" />
                <span>{unknownLabel(value, language)}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            {t(
              "확인되면 이 후보를 다시 평가해 GO 또는 No-Go를 표시합니다.",
              "Once checked, this candidate is reevaluated and shown as GO or No-Go.",
            )}
          </p>
        </details>
      )}
      <div className="card-actions">
        {approvalPath ? (
          <NavLink className="btn btn-primary" to={approvalPath}>
            {c.nextAction.label}
            <Icon name="arrow" />
          </NavLink>
        ) : (
          <p className="muted">
            <Icon name="clock" />
            {c.nextAction.label}
          </p>
        )}
        <NavLink className="text-btn candidate-detail-link" to={`/candidates/${c.id}`}>
          {t("상세 보기", "View details")}
          <Icon name="arrow" />
        </NavLink>
        {onSelect && (
          <button
            type="button"
            className="text-btn evidence-select"
            onClick={onSelect}
            aria-pressed={selected}
          >
            {t("근거 보기", "View evidence")}
          </button>
        )}
      </div>
    </article>
  );
}
export function Candidates() {
  const q = useCandidates();
  const { t, language } = useLocale();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const matchesToolbar = (candidate: CandidateView) =>
    candidate.keyword.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
    (filter === "all" || candidate.nextAction.kind === filter);
  const toolbarList = (q.data ?? []).filter(matchesToolbar);
  const counts = decisionFilters.reduce<Record<string, number>>(
    (result, decision) => {
      result[decision] = toolbarList.filter((candidate) => candidate.decision === decision).length;
      return result;
    },
    {},
  );
  const list = toolbarList.filter(
    (candidate) => decisionFilter === "all" || candidate.decision === decisionFilter,
  );
  const actionableList = list.filter((candidate) => candidate.decision !== "waiting");
  const waitingList = list.filter((candidate) => candidate.decision === "waiting");
  const waitingReasons = [...waitingList.reduce((result, candidate) => {
    const current = result.get(candidate.nextAction.target);
    result.set(candidate.nextAction.target, {
      label: candidate.nextAction.label,
      count: (current?.count ?? 0) + 1,
    });
    return result;
  }, new Map<string, { label: string; count: number }>()).values()];
  const waitingReasonSummary = waitingReasons
    .slice(0, 3)
    .map((reason) => `${reason.label} ${reason.count}`)
    .join(" · ");
  const renderCards = (candidates: CandidateView[]) => (
    <div className="stack">
      {candidates.map((candidate) => (
        <CandidateCard candidate={candidate} key={candidate.id} />
      ))}
    </div>
  );
  return (
    <>
      <PageHeader
        title={t("후보", "Candidates")}
        description={t(
          "지금 단계, 근거, 모르는 것. 후보마다 다음 행동을 확인하세요.",
          "The stage, evidence, and unknowns. One next action for each candidate.",
        )}
      >
        <NavLink className="btn btn-secondary" to="/research">
          <Icon name="import" />
          {t("제품 가져오기", "Import products")}
        </NavLink>
      </PageHeader>
      <div className="decision-summary" aria-label={t("판정별 후보 수", "Candidates by decision")}>
        <button type="button" aria-pressed={decisionFilter === "all"} className={`decision-summary-item${decisionFilter === "all" ? " selected" : ""}`} onClick={() => setDecisionFilter("all")}>
          <strong>{q.data?.length ?? 0}</strong>
          <span>{t("전체", "All")}</span>
        </button>
        {decisionFilters.map((decision) => {
          const meta = decisionMeta[decision];
          return (
            <button key={decision} type="button" aria-pressed={decisionFilter === decision} disabled={!counts[decision]} className={`decision-summary-item ${meta.className}${decisionFilter === decision ? " selected" : ""}`} onClick={() => setDecisionFilter(decision)}>
              <strong>{counts[decision] ?? 0}</strong>
              <span>{meta.label[language === "ko" ? 0 : 1]}</span>
            </button>
          );
        })}
      </div>
      <div className="list-toolbar">
        <div className="field search-field">
          <label htmlFor="search">{t("키워드 검색", "Search keywords")}</label>
          <input
            id="search"
            type="search"
            placeholder={t("후보 이름으로 찾기", "Find a candidate")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="status-filter">{t("다음 행동", "Next action")}</label>
          <select
            id="status-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">{t("전체", "All")}</option>
            <option value="approval">{t("승인 대기", "Needs approval")}</option>
            <option value="automatic">{t("자동 확인", "Automatic")}</option>
            <option value="waiting">
              {t("대기·완료", "Waiting / finished")}
            </option>
          </select>
        </div>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError retry={() => void q.refetch()} />
      ) : list.length && decisionFilter === "all" ? (
        <div className="candidate-sections">
          <section className="candidate-section" aria-labelledby="candidate-review-heading">
            <div className="candidate-section-heading">
              <h2 id="candidate-review-heading">
                {t("우선 검토할 후보", "Candidates to review first")} <span className="muted">({actionableList.length})</span>
              </h2>
              <span className="muted">{t("GO·주의·No-Go만 표시", "GO, CAUTION, and NO-GO only")}</span>
            </div>
            {actionableList.length ? renderCards(actionableList) : (
              <p className="muted">
                {t("아직 근거가 충분한 판정 후보가 없습니다. 아래 대기 후보를 확인하세요.", "No candidates have enough evidence for a decision yet. Check the waiting candidates below.")}
              </p>
            )}
          </section>
          <details className="candidate-section candidate-waiting">
            <summary>
              <span>{t("대기 후보", "Waiting candidates")} <span className="muted">{waitingList.length}</span></span>
              {waitingReasonSummary && <span className="muted">{waitingReasonSummary}</span>}
            </summary>
            <p className="muted candidate-waiting-note">
              {t(
                "대기는 탈락이 아닙니다. 후보별 ‘확인할 항목’을 펼치면 무엇이 부족한지 볼 수 있습니다.",
                "Waiting is not a rejection. Expand each candidate’s ‘Items to verify’ to see what is missing.",
              )}
            </p>
            {waitingList.length ? renderCards(waitingList) : (
              <p className="muted">{t("대기 중인 후보가 없습니다.", "No candidates are waiting.")}</p>
            )}
          </details>
        </div>
      ) : list.length ? (
        renderCards(list)
      ) : (
        <Empty
          icon="candidate"
          title={t(
            q.data?.length
              ? "조건에 맞는 후보가 없어요"
              : "아직 가져온 제품이 없어요",
            q.data?.length
              ? "No matching candidates"
              : "No products imported yet",
          )}
          description={t(
            q.data?.length
              ? "검색어나 다음 행동 필터를 바꿔 보세요."
              : "CSV를 가져와 첫 후보를 확인하세요.",
            q.data?.length
              ? "Try a different keyword or filter."
              : "Import a CSV to review your first candidates.",
          )}
        />
      )}
    </>
  );
}
