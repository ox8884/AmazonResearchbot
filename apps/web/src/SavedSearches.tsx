import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  savedSearchFilters,
  type SavedSearch,
  type SavedSearchInput,
} from "../../../packages/domain/src/saved-search.ts";
import {
  listSavedSearches,
  checkSearchConnection,
  type SearchRunSelection,
} from "./saved-search-api.ts";
import { SavedSearchForm } from "./SavedSearchForm.tsx";
import { LoadError, Loading, Stage, useLocale } from "./ui.tsx";
export function SavedSearches({
  onStarted,
  disabled = false,
}: {
  onStarted: (run: SearchRunSelection) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale(),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["saved-searches"],
    queryFn: listSavedSearches,
  });
  const [draft, setDraft] = useState<{ initial?: SavedSearchInput } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null),
    [checking, setChecking] = useState<string | null>(null);
  async function check(id: string) {
    if (checking || disabled) return;
    setChecking(id);
    setNotice(null);
    try {
      const result = await checkSearchConnection(id);
      onStarted(result.run);
      void qc.invalidateQueries({ queryKey: ["search-runs"] });
      setNotice(
        result.nextAction.kind === "automatic"
          ? t("자동 수집 요청을 기록했어요. 아래 조사 기록에서 진행과 결과를 확인하세요.","Collection requested. Check Research history below for progress and results.")
          : result.nextAction.target === "manual_filters"
          ? t("기존 메모 조건은 자동 필터로 해석하지 않습니다. 조건을 복사해 상한을 선택하거나 직접 검색한 CSV를 연결하세요.","Existing notes are not interpreted as automatic filters. Copy the conditions and select limits, or link a manually exported CSV.")
          : result.nextAction.kind === "waiting" &&
          result.nextAction.target === "web_session"
          ? t(
              "ASIDE 자동 수집 연결을 기다리고 있어요. 직접 검색한 CSV를 위에서 연결할 수도 있습니다.",
              "Waiting for the ASIDE export connection. You can also link a manually exported CSV above.",
            )
          : t(
              "실행 결과를 확인하지 못했어요. 후보 목록을 확인해 주세요.",
              "Could not confirm the run. Check the candidate list.",
            ),
      );
    } catch {
      setNotice(
        t(
          "연결 상태를 확인하지 못했어요. 저장한 조건은 그대로입니다.",
          "Could not check the connection. Your saved conditions are preserved.",
        ),
      );
    } finally {
      setChecking(null);
    }
  }
  return (
    <section className="detail-section stack">
      <div className="section-label">
        <h2>{t("저장 검색", "Saved searches")}</h2>
        <button
          className="btn btn-secondary"
          disabled={draft !== null}
          onClick={() => {
            setDraft({});
            setNotice(null);
          }}
        >
          {t("검색 조건 추가", "Add search conditions")}
        </button>
      </div>
      <p className="muted">
        {t(
          "저장한 조건으로 ASIDE가 검색 결과 첫 페이지 CSV를 가져옵니다. Home & Kitchen에서 발굴한 후보는 Kitchen & Dining 분류 확인 후 진행합니다.",
          "ASIDE imports the first results-page CSV using your saved conditions. Candidates found in Home & Kitchen proceed only after Kitchen & Dining membership is confirmed.",
        )}
      </p>
      {notice && (
        <p className="banner" role="status">
          {notice}
        </p>
      )}
      {draft && (
        <SavedSearchForm
          initial={draft.initial}
          onCancel={() => setDraft(null)}
          onSaved={(id, input) => {
            qc.setQueryData<{ searches: SavedSearch[] }>(
              ["saved-searches"],
              (current) => ({
                searches: [
                  ...(current?.searches ?? []),
                  { id, ...input, marketplace: "us", revision: 1 },
                ],
              }),
            );
            setDraft(null);
            setNotice(
              t(
                "검색 조건을 저장했어요. 웹 검색은 아직 실행하지 않았습니다.",
                "Search conditions saved. No web search has run.",
              ),
            );
            void qc.invalidateQueries({ queryKey: ["saved-searches"] });
          }}
        />
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <LoadError retry={() => void query.refetch()} />
      ) : (
        <>
          {query.isError && <LoadError retry={() => void query.refetch()} />}
          {!query.data?.searches.length && (
            <p className="muted">
              {t(
                "저장한 검색이 없어요. 자주 쓰는 조건을 먼저 추가하세요.",
                "No saved searches yet. Add conditions you use regularly.",
              )}
            </p>
          )}
          {query.data?.searches.map((search) => {
            const parsed = savedSearchFilters.safeParse(search.filters);
            const filters = parsed.success ? parsed.data : null;
            const copy =
              filters &&
              search.marketplace === "us" &&
              search.category === "Kitchen & Dining"
                ? {
                    name: search.name,
                    category: "Kitchen & Dining" as const,
                    filters,
                  }
                : null;
            return (
              <article key={search.id} className="connection-row">
                <div className="stack">
                  <h3>{search.name}</h3>
                  <p className="muted">
                    {search.marketplace.toUpperCase()} ·{" "}
                    {search.category ??
                      t("카테고리 미확인", "Category unknown")}{" "}
                    · r{search.revision}
                  </p>
                  {filters ? (
                    <dl className="quote-terms">
                      <div>
                        <dt>{t("월평균 가격 (USD)", "Monthly average price (USD)")}</dt>
                        <dd>
                          {filters.priceMinUsd ?? t("하한 없음", "No minimum")}{" "}
                          –{" "}
                          {filters.priceMaxUsd ?? t("상한 없음", "No maximum")}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          {t("월 검색량 최소", "Minimum monthly searches")}
                        </dt>
                        <dd>
                          {filters.monthlySearchMin ??
                            t("지정 안 함", "Unspecified")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("경쟁도 상한", "Maximum competition")}</dt>
                        <dd>
                          {filters.competitionMax ??
                            t("지정 안 함", "Unspecified")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("계절성 상한", "Maximum seasonality")}</dt>
                        <dd>
                          {filters.seasonalityMax ??
                            t("지정 안 함", "Unspecified")}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="muted">
                      {t(
                        "이전에 저장한 조건은 이 화면에서 편집할 수 없어요. 원래 기록은 보존됩니다.",
                        "These older conditions cannot be edited here. The original record is preserved.",
                      )}
                    </p>
                  )}
                  {filters?.competition && <p>{t('이전 경쟁 메모','Previous competition note')}: {filters.competition}</p>}
                  {filters?.seasonality && <p>{t('이전 계절성 메모','Previous seasonality note')}: {filters.seasonality}</p>}
                  <div className="btn-row">
                    <button
                      className="btn btn-secondary"
                      disabled={disabled || Boolean(checking) || draft !== null}
                      onClick={() => void check(search.id)}
                    >
                      {checking === search.id
                        ? t("확인 중", "Checking")
                        : t(
                            "이 조건으로 조사 시작",
                            "Start research with these conditions",
                          )}
                    </button>
                    <button
                      className="text-btn"
                      disabled={!copy || draft !== null}
                      onClick={() => {
                        if (copy) setDraft({ initial: copy });
                      }}
                    >
                      {t("조건 복사", "Copy conditions")}
                    </button>
                  </div>
                </div>
                <Stage>{t("저장된 조건", "Saved conditions")}</Stage>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
