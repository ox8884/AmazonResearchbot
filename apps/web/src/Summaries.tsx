import { SummarySnapshot } from "./SummarySnapshot.tsx";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useSearchParams } from "react-router";
import { listSummaries, getSummary } from "./summary-api.ts";
import { Empty, LoadError, Loading, PageHeader, useLocale } from "./ui.tsx";
export function Summaries() {
  const { t } = useLocale();
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ["summaries"], queryFn: listSummaries });
  const id = params.get("id") || list.data?.summaries[0]?.id;
  const detail = useQuery({
    queryKey: ["summary", id],
    queryFn: () => getSummary(id ?? ""),
    enabled: Boolean(id),
  });
  const record = detail.data;
  const outsideList = Boolean(id && !list.data?.summaries.some(summary => summary.id === id));
  return (
    <>
      <NavLink className="back-link" to="/">
        {t("오늘로", "Back to today")}
      </NavLink>
      <PageHeader
        title={t("아침 업무 요약", "Morning work summaries")}
        description={t(
          "생성 당시의 한국어 기록입니다. 현재 상태는 후보 상세에서 확인하세요.",
          "These are Korean snapshots from their creation time. Check candidates for their current state.",
        )}
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError && !list.data ? (
        <LoadError retry={() => void list.refetch()} />
      ) : (
        <>
          {list.isError && <LoadError retry={() => void list.refetch()} />}
          {!list.data?.summaries.length && !id ? (
            <Empty
              title={t("아직 저장된 요약이 없어요", "No saved summaries yet")}
              description={t(
                "승인된 요약 시간이 되면 앱 안에 기록합니다.",
                "A summary is stored in the app at the approved time.",
              )}
              to="/settings"
              action={t("일정 확인", "Review schedule")}
            />
          ) : (
            <>
              <div className="field">
                <label htmlFor="summary-date">
                  {t("요약 선택", "Choose a summary")}
                </label>
                <select
                  id="summary-date"
                  aria-describedby="summary-date-help"
                  value={id ?? ""}
                  onChange={(event) => setParams({ id: event.target.value })}
                >
                  {outsideList && (
                    <option value={id} disabled={!record}>
                      {record
                        ? `${record.localDate} · ${record.timezone}`
                        : detail.isError
                          ? t("선택한 요약을 불러오지 못했어요", "Selected summary unavailable")
                          : t("선택한 요약 불러오는 중", "Loading selected summary")}
                    </option>
                  )}
                  {list.data?.summaries.map((summary) => (
                    <option key={summary.id} value={summary.id}>
                      {summary.localDate} · {summary.timezone}
                    </option>
                  ))}
                </select>
                <p className="muted" id="summary-date-help">
                  {t("최근 30개와 현재 선택한 기록을 표시합니다.", "Shows the latest 30 summaries and the selected record.")}
                </p>
              </div>
              {detail.isPending ? (
                <Loading />
              ) : detail.isError && !record ? (
                <LoadError retry={() => void detail.refetch()} />
              ) : record ? (
                <>
                  {detail.isError && (
                    <LoadError retry={() => void detail.refetch()} />
                  )}
                  <SummarySnapshot record={record} />
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </>
  );
}
