import { candidateApprovalPath } from "./candidate-links.ts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router";
import { listCandidates, type CandidateView } from "./api.ts";
import { evidenceText } from "./evidence.ts";
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
  const approvalPath = candidateApprovalPath(c);
  return (
    <article className={`card candidate-card${selected ? " selected" : ""}`}>
      <Stage>{c.stageLabel}</Stage>
      <h3>
        <NavLink className="keyword-link" to={`/candidates/${c.id}`}>
          {c.keyword}
        </NavLink>
      </h3>
      <p>{evidenceText(c.evidenceSummary, language)}</p>
      <div className="unknown-summary">
        <span className="muted">{t("모르는 것", "Unknown")}</span>
        <Unknowns values={c.unknowns} />
      </div>
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
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const list = (q.data ?? []).filter(
    (c) =>
      c.keyword.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (filter === "all" || c.nextAction.kind === filter),
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
      ) : list.length ? (
        <div className="stack">
          {list.map((c) => (
            <CandidateCard candidate={c} key={c.id} />
          ))}
        </div>
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
