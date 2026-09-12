import type { SpecRecord } from "../../../packages/domain/src/sourcing.ts";
import { contactSaveError } from "./contact-labels.ts";
import { useState, type FormEvent } from "react";
import { createSupplier } from "./contact-api.ts";
import { useLocale } from "./ui.tsx";

type SaveHandler = () => Promise<void>;

export function ContactSupplierForm({
  candidateId,
  specs,
  onSaved,
}: {
  candidateId: string;
  specs: SpecRecord[];
  onSaved: SaveHandler;
}) {
  const { t, language } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [matchStatus, setMatchStatus] = useState<
    "matches" | "mismatch" | "unknown"
  >("unknown");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await createSupplier(candidateId, {
        name: text("name"),
        specId: text("specId") || null,
        email: text("email") || null,
        source: text("source"),
        observedAt: new Date(text("observedAt")).toISOString(),
        matchStatus,
        matchNotes: text("matchNotes"),
      });
      await onSaved();
      setSaved(true);
    } catch (caught) {
      setError(contactSaveError(caught, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="contact-form stack" onSubmit={submit}>
      <header className="stack">
        <h2>{t("공급처 등록", "Register supplier")}</h2>
        <p className="muted">
          {t("출처·확인 시점·제품 일치 근거를 함께 남깁니다.", "Record the source, observation time, and product-match evidence.")}{" "}
          <span className="copy-phrase">{t("이메일을 모르면 비워 두세요.", "Leave email blank when it is unknown.")}</span>
        </p>
      </header>
      <fieldset disabled={busy}>
        <div className="contact-form-grid">
          <div className="field contact-form-wide">
            <label htmlFor="supplier-spec">
              {t("확인한 사양 버전", "Specification reviewed")}
            </label>
            <select id="supplier-spec" name="specId" defaultValue="">
              <option value="">
                {t("미확인 · 자동 초안 제외", "Unknown · no automatic draft")}
              </option>
              {specs.map((spec) => (
                <option
                  key={spec.id}
                  value={spec.id}
                >{`${spec.aiTaskId ? t("AI 제안 · ", "AI proposal · ") : ""}r${spec.revision} · ${spec.material} · ${spec.dimensions}`}</option>
              ))}
            </select>
            <p className="muted">
              {t(
                "최신 사양·일치 근거·이메일을 확인하세요. 초안은 자동으로 준비됩니다. 발송은 따로 승인합니다.",
                "A match to the latest specification and a confirmed email prepare an RFQ for approval. Sending requires a separate approval.",
              )}
            </p>
          </div>
          <div className="field">
            <label htmlFor="supplier-name">
              {t("공급처명", "Supplier name")}
            </label>
            <input id="supplier-name" name="name" required maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="supplier-email">
              {t("이메일 · 모르면 비움", "Email · leave blank if unknown")}
            </label>
            <input
              id="supplier-email"
              name="email"
              type="email"
              maxLength={320}
            />
          </div>
          <div className="field contact-form-wide">
            <label htmlFor="supplier-observed-at">
              {t("확인 시점", "Observed at")}
            </label>
            <input
              id="supplier-observed-at"
              name="observedAt"
              type="datetime-local"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="supplier-match-status">
              {t("사양 일치", "Specification match")}
            </label>
            <select
              id="supplier-match-status"
              name="matchStatus"
              value={matchStatus}
              onChange={(event) => {
                const next = event.target.value;
                if (
                  next === "matches" ||
                  next === "mismatch" ||
                  next === "unknown"
                )
                  setMatchStatus(next);
              }}
            >
              <option value="matches">{t("일치", "Matches")}</option>
              <option value="mismatch">{t("불일치", "Mismatch")}</option>
              <option value="unknown">{t("미확인", "Unknown")}</option>
            </select>
          </div>
          <div className="field contact-form-wide">
            <label htmlFor="supplier-source">{t("출처", "Source")}</label>
            <textarea
              id="supplier-source"
              name="source"
              rows={3}
              required
              maxLength={10000}
            />
          </div>
          <div className="field contact-form-wide">
            <label htmlFor="supplier-match-notes">
              {t("일치 여부 근거", "Match notes")}
            </label>
            <textarea
              id="supplier-match-notes"
              name="matchNotes"
              rows={3}
              maxLength={4000}
              required={matchStatus === "matches"}
            />
          </div>
        </div>
      </fieldset>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="save-notice" role="status">
          {t("공급처를 저장했습니다.", "Supplier saved.")}
        </p>
      )}
      <button className="btn btn-secondary" disabled={busy}>
        {busy ? t("저장 중", "Saving") : t("공급처 저장", "Save supplier")}
      </button>
    </form>
  );
}
