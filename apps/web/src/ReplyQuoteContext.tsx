import { NavLink } from "react-router";
import type { InboxQuotePreview } from "../../../packages/domain/src/quote-preview.ts";
import { LoadError, useLocale } from "./ui.tsx";
export function ReplyQuoteContext({
  id,
  preview,
  pending,
  error,
  mismatch,
  retry,
}: {
  readonly id: string;
  readonly preview: InboxQuotePreview | undefined;
  readonly pending: boolean;
  readonly error: boolean;
  readonly mismatch: boolean;
  readonly retry: () => void;
}) {
  const { t } = useLocale();
  if (!preview)
    return pending ? (
      <p className="muted">
        {t("회신 조건을 불러오는 중", "Loading reply conditions")}
      </p>
    ) : (
      <LoadError retry={retry} />
    );
  const target =
    preview.candidateId && preview.specId
      ? new URLSearchParams({
          candidate: preview.candidateId,
          spec: preview.specId,
          reply: id,
        })
      : null;
  const missingCore = preview.bound && !preview.complete;
  const manualTarget =
    preview.candidateId && preview.specId
      ? new URLSearchParams({
          candidate: preview.candidateId,
          spec: preview.specId,
        })
      : null;
  return (
    <section className="quiet">
      <h2>{t("회신에서 가져온 조건", "Conditions from the reply")}</h2>
      {error && (
        <p className="banner" role="alert">
          {t(
            "회신 정보를 다시 확인하지 못했어요. 입력한 내용은 유지됩니다.",
            "Could not refresh the reply. Your entries are preserved.",
          )}{" "}
          <button className="text-btn" onClick={retry}>
            {t("다시 확인", "Retry")}
          </button>
        </p>
      )}
      {mismatch ? (
        <p className="banner">
          {t(
            "이 회신에 연결된 후보·사양과 다릅니다.",
            "This selection differs from the candidate and specification linked to the reply.",
          )}{" "}
          {target && (
            <NavLink to={"/sourcing?" + target.toString()}>
              {t(
                "연결된 후보·사양으로",
                "Use the linked candidate and specification",
              )}
            </NavLink>
          )}
        </p>
      ) : (
        <p className="muted">
          {!preview.bound
            ? t(
                "회신의 대상이 확정되지 않았습니다. 원문을 확인하고 필요한 내용을 직접 기록하세요.",
                "The reply is not assigned. Check the original and record the required information manually.",
              )
            : preview.quote
              ? t(
                  "기록된 견적이 있습니다. 원문 조건을 유지하면서 나머지 비용 근거를 보완할 수 있어요.",
                  "A quote is already recorded. Keep its supplier terms and add the remaining cost evidence.",
                )
              : t(
                  "회신에 명확히 적힌 조건만 가져옵니다. 빈칸은 미확인으로 남습니다.",
                  "Only explicit reply conditions are copied. Missing fields stay unknown.",
                )}
        </p>
      )}
      {missingCore && !mismatch && (
        <p className="banner">
          {t(
            "회신의 단가·수량·최소 주문 수량·운송 조건·확인 시각이 충분하지 않아 이 원문에 연결된 견적을 기록할 수 없어요. 확인 자료가 있다면 별도 수동 견적으로 기록하세요.",
            "The reply lacks complete price, quantity, MOQ, shipping terms, or an observed date. A quote cannot be recorded against this source. Record a separate manual quote if you have supporting evidence.",
          )}{" "}
          {manualTarget && (
            <NavLink to={"/sourcing?" + manualTarget.toString()}>
              {t("별도 수동 견적 기록으로", "Record a separate manual quote")}
            </NavLink>
          )}
        </p>
      )}
      <NavLink className="text-btn" to={`/inbox/${encodeURIComponent(id)}`}>
        {t("회신 원문 보기", "View original reply")}
      </NavLink>
      <details>
        <summary>
          {t("가져온 원문·조건 보기", "View source conditions")}
        </summary>
        <p className="source-text">{preview.sourceText}</p>
      </details>
    </section>
  );
}
