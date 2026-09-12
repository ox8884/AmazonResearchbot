import { useState, type FormEvent } from "react";
import {
  savedSearchInput,
  searchLevelSchema,
  type SavedSearchInput,
} from "../../../packages/domain/src/saved-search.ts";
import { saveSearch, SavedSearchRequestError } from "./saved-search-api.ts";
import { useLocale } from "./ui.tsx";
export function SavedSearchForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: SavedSearchInput;
  onSaved: (id: string, input: SavedSearchInput) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget),
      value = (key: string) => String(form.get(key) ?? "").trim();
    const demand = value("monthlySearchMin");
    const parsed = savedSearchInput.safeParse({
      name: value("searchName"),
      category: "Kitchen & Dining",
      filters: {
        ...(value("priceMinUsd") ? { priceMinUsd: value("priceMinUsd") } : {}),
        ...(value("priceMaxUsd") ? { priceMaxUsd: value("priceMaxUsd") } : {}),
        ...(demand ? { monthlySearchMin: Number(demand) } : {}),
        ...(value("competition") ? { competition: value("competition") } : {}),
        ...(value("seasonality") ? { seasonality: value("seasonality") } : {}),
        ...(value("competitionMax") ? { competitionMax: value("competitionMax") } : {}),
        ...(value("seasonalityMax") ? { seasonalityMax: value("seasonalityMax") } : {}),
      },
    });
    if (!parsed.success) {
      setError(
        t(
          "검색 이름과 가격 범위를 확인해 주세요. 최소 가격은 최대 가격 이하여야 합니다.",
          "Check the search name and price range. Minimum price must not exceed maximum.",
        ),
      );
      return;
    }
    setNeedsLogin(false);
    setBusy(true);
    setError(null);
    try {
      const result = await saveSearch(parsed.data);
      onSaved(result.id, parsed.data);
    } catch (failure) {
      const authenticationRequired =
        failure instanceof SavedSearchRequestError && failure.status === 401;
      setNeedsLogin(authenticationRequired);
      setError(
        authenticationRequired
          ? t(
              "다시 로그인해 주세요. 입력은 이 화면에 보존됩니다.",
              "Please sign in again. Your entries are preserved on this page.",
            )
          : t(
              "저장 결과를 확인하지 못했어요. 입력은 유지됩니다. 저장 목록을 확인한 뒤 다시 시도하세요.",
              "Could not confirm the save. Your entries are preserved. Check the saved list before retrying.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="sourcing-form stack" onSubmit={submit}>
      <h3>{t("검색 조건 저장", "Save search conditions")}</h3>
      <p className="muted">
        {t(
          "Amazon US · Home & Kitchen에서 발굴한 뒤 Kitchen & Dining 분류를 확인합니다. 비워 둔 조건은 제한하지 않습니다.",
          "Amazon US · Discover in Home & Kitchen, then verify Kitchen & Dining membership. Blank conditions add no limit.",
        )}
      </p>
      <fieldset className="form-grid" disabled={busy}>
        <div className="field full-width">
          <label htmlFor="searchName">{t("검색 이름", "Search name")}</label>
          <input
            id="searchName"
            name="searchName"
            maxLength={120}
            required
            defaultValue={initial?.name ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="priceMinUsd">
            {t("최소 월평균 가격 (USD)", "Minimum monthly average price (USD)")}
          </label>
          <input
            id="priceMinUsd"
            name="priceMinUsd"
            inputMode="decimal"
            pattern="[0-9]{1,7}(\.[0-9]{1,2})?"
            defaultValue={initial?.filters.priceMinUsd ?? ""}
            placeholder={t("지정 안 함", "Unspecified")}
          />
        </div>
        <div className="field">
          <label htmlFor="priceMaxUsd">
            {t("최대 월평균 가격 (USD)", "Maximum monthly average price (USD)")}
          </label>
          <input
            id="priceMaxUsd"
            name="priceMaxUsd"
            inputMode="decimal"
            pattern="[0-9]{1,7}(\.[0-9]{1,2})?"
            defaultValue={initial?.filters.priceMaxUsd ?? ""}
            placeholder={t("지정 안 함", "Unspecified")}
          />
        </div>
        <div className="field full-width">
          <label htmlFor="monthlySearchMin">
            {t("월 검색량 최소", "Minimum monthly searches")}
          </label>
          <input
            id="monthlySearchMin"
            name="monthlySearchMin"
            type="number"
            min="0"
            max="1000000000"
            step="1"
            defaultValue={initial?.filters.monthlySearchMin ?? ""}
            placeholder={t("지정 안 함", "Unspecified")}
          />
        </div>
        {(['competitionMax','seasonalityMax'] as const).map(field=><div className="field" key={field}>
          <label htmlFor={field}>{field==='competitionMax'?t('경쟁도 상한','Maximum competition'):t('계절성 상한','Maximum seasonality')}</label>
          <select id={field} name={field} defaultValue={initial?.filters[field]??''}>
            <option value="">{t('제한 없음','No limit')}</option>
            {searchLevelSchema.options.map((level,index)=><option value={level} key={level}>{t(['매우 낮음','낮음','보통','높음','매우 높음'][index]??level,level)}{t(' 이하',' or lower')}</option>)}
          </select>
        </div>)}
        {initial?.filters.competition && <div className="field">
          <label htmlFor="competition">
            {t("이전 경쟁 메모 · 수동 확인", "Previous competition note · manual review")}
          </label>
          <textarea
            id="competition"
            name="competition"
            rows={3}
            maxLength={500}
            defaultValue={initial?.filters.competition ?? ""}
            placeholder={t(
              "웹 검색에서 확인할 경쟁 조건",
              "Conditions to check in the web search",
            )}
          />
        </div>}
        {initial?.filters.seasonality && <div className="field">
          <label htmlFor="seasonality">
            {t("이전 계절성 메모 · 수동 확인", "Previous seasonality note · manual review")}
          </label>
          <textarea
            id="seasonality"
            name="seasonality"
            rows={3}
            maxLength={500}
            defaultValue={initial?.filters.seasonality ?? ""}
            placeholder={t(
              "확인할 계절성·수요 기간",
              "Seasonality and demand period to check",
            )}
          />
        </div>}
      </fieldset>
      <p className="muted">
        {t(
          "경쟁도와 계절성은 선택한 등급 이하로 검색합니다. 이전 메모가 있으면 자동 해석하지 않습니다. 내용을 확인해 비우고 상한을 선택하면 자동 검색을 사용할 수 있습니다. 저장만으로 검색을 시작하지는 않습니다.",
          "Competition and seasonality use the selected level as an upper limit. Existing notes are not interpreted automatically: review and clear them, then select limits to use automatic search. Saving does not start a search.",
        )}
      </p>
      {needsLogin && (
        <a
          className="text-btn"
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("새 탭에서 로그인", "Sign in in a new tab")}
        </a>
      )}
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy}>
          {busy
            ? t("저장 중", "Saving")
            : t("새 검색으로 저장", "Save as a new search")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          {t("취소", "Cancel")}
        </button>
      </div>
    </form>
  );
}
