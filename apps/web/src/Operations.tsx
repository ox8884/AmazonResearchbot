import { SearchRunHistory } from "./SearchRunHistory.tsx";
import {listSearchRuns,type SearchRunSelection} from "./saved-search-api.ts";
import { SavedSearches } from "./SavedSearches.tsx";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router";
import { uploadCsv } from "./api.ts";
import { CsvImportPanel } from "./CsvImportPanel.tsx";
import type { CsvMapping } from "../../../packages/domain/src/csv-import.ts";
import { Icon, PageHeader, useLocale } from "./ui.tsx";

export function Research() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<SearchRunSelection | null>(
    null,
  );
  const history=useQuery({queryKey:['search-runs'],queryFn:listSearchRuns,enabled:Boolean(selectedRun)});
  const activeRun=selectedRun&&history.data?.runs.find(run=>run.id===selectedRun.id)?.state!=='imported'?selectedRun:null;
  const [issues, setIssues] = useState<
    readonly { rowNumber: number; error: string }[]
  >([]);
  function selectRun(run: SearchRunSelection) {
    setSelectedRun(run);
    if(run.mode!=='browser')document.getElementById("csv")?.focus();
  }
  async function onFile(file: File, review: { mapping: CsvMapping; expectedSha256: string }): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    setIssues([]);
    try {
      const result = await uploadCsv(file, activeRun?.id, review);
      if (result.status >= 400) {
        setIssues(result.body.rows);
        setMessage(
          result.body.code === "IMPORT_MAPPING_CONFLICT"
            ? t("이 파일은 이미 다른 열 선택으로 가져왔어요. 기존 후보를 확인해 주세요. 원본을 다시 해석해 덮어쓰지는 않습니다.", "This file was already imported with different columns. Review the existing candidates; its interpretation cannot be overwritten.")
            : result.body.code === "FILE_CHANGED"
            ? t("확인한 파일과 다릅니다. 파일을 다시 선택해 확인해 주세요.", "The file differs from the reviewed version. Select and review it again.")
            : result.body.code === "SEARCH_RUN_ALREADY_IMPORTED"
            ? t(
                "이 조사에는 이미 다른 CSV가 연결되어 있어요. 새 조사를 시작해 주세요. 기존 원본과 후보는 그대로입니다.",
                "This run already has a different CSV. Start a new run. Existing sources and candidates are preserved.",
              )
            : result.body.rows.length > 0
              ? t(
                  "가져오지 못했어요. 아래 내용을 확인한 뒤 CSV를 다시 선택해 주세요.",
                  "Import failed. Check the details below, then select the CSV again.",
                )
              : t(
                  "가져오기 결과를 확인하지 못했어요. 후보 목록을 확인한 뒤 다시 시도해 주세요.",
                  "Could not confirm the import result. Check the candidate list before trying again.",
                ),
        );
        return false;
      }
      setMessage(
        result.body.reused
          ? t(
              "같은 파일의 기존 후보를 그대로 사용합니다.",
              "This file was already imported. Existing candidates are preserved.",
            )
          : typeof result.body.created === "number"
            ? t(
                `후보 ${result.body.created}개를 가져왔어요. 후보 화면에서 확인하세요.`,
                `Imported ${result.body.created} candidates. Open Candidates to review them.`,
              )
            : t(
                "가져오기 결과를 확인하지 못했어요. 후보 목록을 확인해 주세요.",
                "Couldn’t confirm the import count. Check the candidate list.",
              ),
      );
      setSelectedRun(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["candidates"] }),
        qc.invalidateQueries({ queryKey: ["search-runs"] }),
      ]);
      return true;
    } catch {
      setMessage(
        t(
          "연결하지 못했어요. 후보 목록을 확인한 뒤 다시 시도해 주세요.",
          "Connection failed. Check the candidate list before trying again.",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title={t("제품 가져오기", "Import products")}
        description={t(
          "키워드에서 시작해, 하나씩 근거를 확인합니다.",
          "Start with keywords. Build evidence for each candidate.",
        )}
      />
      <section className="card import-panel">
        <Icon name="import" />
        <h2>{t("CSV로 후보 가져오기", "Import candidates from CSV")}</h2>
        <p className="muted">
          {t(
            "서로 다른 키워드 한 행이 후보 하나가 됩니다. 비어 있는 숫자는 미확인으로 남습니다.",
            "Each distinct keyword becomes a candidate. Missing numbers stay unknown.",
          )}
        </p>
        {activeRun && (
          <div className="banner" role="status">
            <p>
              {t("연결할 조사", "Research to link")}:{" "}
              <strong>{activeRun.snapshot.name}</strong>
            </p>
            <p>
              {activeRun.mode==='browser'?t('ASIDE 자동 수집 결과는 아래 조사 기록에서 확인할 수 있어요. 필요하면 직접 내려받은 CSV를 연결할 수도 있습니다.','Check Research history below for the ASIDE result. You can also link a manually downloaded CSV if needed.'):t(
                "웹에서 같은 조건으로 검색한 CSV를 선택하세요. 실제 조건 적용 여부는 미확인입니다.",
                "Select the CSV searched with these conditions. Applied filters remain unverified.",
              )}
            </p>
            <button
              className="text-btn"
              disabled={busy}
              onClick={() => setSelectedRun(null)}
            >
              {t("조사 연결 없이 가져오기", "Import without a research link")}
            </button>
          </div>
        )}
        <CsvImportPanel busy={busy} onBusy={value => {
          setBusy(value);
          if (value) { setMessage(null); setIssues([]); }
        }} onImport={onFile} />
        {busy && <p role="status">{t("파일을 처리하는 중", "Processing file")}</p>}
        {message && (
          <p className="banner" role="status">
            {message}
          </p>
        )}
        {issues.length > 0 && (
          <div className="quiet">
            <ul>
              {issues.slice(0, 10).map((issue) => (
                <li key={issue.rowNumber}>
                  {t(
                    `데이터 ${issue.rowNumber}행`,
                    `Data row ${issue.rowNumber}`,
                  )}{" "}
                  ·{" "}
                  {issue.error === "keyword column required"
                    ? t(
                        "첫 행에 keyword 열이 필요합니다.",
                        "A keyword column is required in the header.",
                      )
                    : issue.error === "duplicate columns"
                      ? t(
                          "열 이름이 중복됩니다. 각 열의 이름을 다르게 지정하세요.",
                          "Column names are duplicated. Give each column a unique name.",
                        )
                      : issue.error === "marketplace must be us"
                        ? t(
                            "US 시장 CSV만 가져올 수 있습니다.",
                            "Only US-market CSV files can be imported.",
                          )
                        : issue.error === "missing keyword"
                          ? t(
                              "키워드가 비어 있습니다.",
                              "The keyword is empty.",
                            )
                          : issue.error.startsWith("duplicate keyword of row ")
                            ? t(
                                "같은 파일에 중복된 키워드가 있습니다.",
                                "This keyword occurs more than once in the file.",
                              )
                            : t(
                                "이 행의 형식을 확인해 주세요.",
                                "Check this row's format.",
                              )}
                </li>
              ))}
            </ul>
            {issues.length > 10 && (
              <p className="muted">
                {t(
                  `오류 ${issues.length}개 중 처음 10개를 표시합니다.`,
                  `Showing the first 10 of ${issues.length} issues.`,
                )}
              </p>
            )}
          </div>
        )}
        <NavLink className="text-btn" to="/candidates">
          {t("후보 목록 보기", "View candidates")}
          <Icon name="arrow" />
        </NavLink>
      </section>
      <SavedSearches onStarted={selectRun} disabled={busy} />
      <SearchRunHistory onResume={selectRun} disabled={busy} />
    </>
  );
}
