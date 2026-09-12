import { useQuery } from "@tanstack/react-query";
import { listSearchRuns, type SearchRunSelection } from "./saved-search-api.ts";
import { savedSearchFilters } from "../../../packages/domain/src/saved-search.ts";
import { LoadError, Loading, Stage, useLocale } from "./ui.tsx";

export function SearchRunHistory({
  onResume,
  disabled,
}: {
  onResume: (run: SearchRunSelection) => void;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const query = useQuery({
    queryKey: ["search-runs"],
    queryFn: listSearchRuns,
    refetchInterval: current => current.state.data?.runs.some(run=>run.state==='awaiting_csv') ? 5000 : false,
  });
  return (
    <section className="detail-section stack">
      <h2>{t("조사 기록", "Research history")}</h2>
      <p className="muted">
        {t(
          "최근 조사 30건입니다. 원본 CSV와 시작 당시 조건을 보존합니다. 수동 CSV의 출처와 검색 조건은 미확인입니다.",
          "The latest 30 runs preserve the original CSV and starting conditions. Linking a file does not verify its applied filters or official origin.",
        )}
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <LoadError retry={() => void query.refetch()} />
      ) : (
        <>
          {query.isError && <LoadError retry={() => void query.refetch()} />}
          {!query.data?.runs.length && (
            <p className="muted">
              {t(
                "아직 시작한 조사가 없어요. 위에서 저장한 조건을 선택하세요.",
                "No research runs yet. Start with saved conditions above.",
              )}
            </p>
          )}
          {query.data?.runs.map((run) => {
            const parsed = savedSearchFilters.safeParse(run.snapshot.filters);
            const filters = parsed.success ? parsed.data : null;
            return (
              <article key={run.id} className="connection-row">
                <div className="stack">
                  <h3>{run.snapshot.name}</h3>
                  <p className="muted">
                    <time dateTime={run.createdAt}>
                      {new Date(run.createdAt).toLocaleString(
                        t("ko-KR", "en-US"),
                      )}
                    </time>{" "}
                    · {run.mode==='browser'?t("ASIDE 자동 수집", "ASIDE collection"):t("수동 CSV", "Manual CSV")}
                  </p>
                  <p>
                    {run.filename ??
                      t("아직 연결한 CSV가 없습니다.", "No CSV linked yet.")}
                  </p>
                  {run.state === "imported" && (
                    <p>
                      {run.linkedCandidates === null
                        ? t(
                            "연결 후보 수 미확인",
                            "Linked candidate count unknown",
                          )
                        : t(
                            `연결 후보 ${run.linkedCandidates}개`,
                            `${run.linkedCandidates} linked candidates`,
                          )}
                    </p>
                  )}
                  <details>
                    <summary>
                      {t("시작 당시 검색 조건", "Search conditions at start")}
                    </summary>
                    <p>
                      {run.snapshot.marketplace.toUpperCase()} ·{" "}
                      {run.snapshot.category ??
                        t("카테고리 미확인", "Category unknown")}
                    </p>
                    {filters ? (
                      <dl className="quote-terms">
                        <div>
                          <dt>{t("월평균 가격 (USD)", "Monthly average price (USD)")}</dt>
                          <dd>
                            {filters.priceMinUsd ??
                              t("하한 없음", "No minimum")}{" "}
                            –{" "}
                            {filters.priceMaxUsd ??
                              t("상한 없음", "No maximum")}
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
                      <p>
                        {t(
                          "이전 형식의 조건입니다. 저장 기록은 보존됩니다.",
                          "Conditions use an older format. The record is preserved.",
                        )}
                      </p>
                    )}
                    {filters?.competition && <p>{t('이전 경쟁 메모','Previous competition note')}: {filters.competition}</p>}
                    {filters?.seasonality && <p>{t('이전 계절성 메모','Previous seasonality note')}: {filters.seasonality}</p>}
                    <p className="muted">
                      {run.filterVerification==='applied'?t('웹 검색 조건 적용 확인 · 상품 분류는 별도 확인','Website filters verified · product category requires a separate check'):t(
                        "실제 웹 검색 조건 적용 · 미확인",
                        "Applied website filters · Unverified",
                      )}
                    </p>
                  </details>
                  {run.state === "awaiting_csv" && (
                    <button
                      className="btn btn-secondary"
                      disabled={disabled}
                      onClick={() => onResume(run)}
                    >
                      {t("이 조사에 CSV 연결", "Link CSV to this run")}
                    </button>
                  )}
                </div>
                <Stage>
                  {run.state === "awaiting_csv"
                    ? run.mode==='browser'?t("자동 수집 대기", "Awaiting collection"):t("CSV 대기", "Waiting for CSV")
                    : t("CSV 연결됨", "CSV linked")}
                </Stage>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
