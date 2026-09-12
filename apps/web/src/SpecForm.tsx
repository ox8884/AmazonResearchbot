import { useState,type FormEvent } from "react";
import type {
SpecInput,
SpecRecord,
} from "../../../packages/domain/src/sourcing.ts";
import { createSpec } from "./quote-api.ts";
import { useLocale } from "./ui.tsx";
export function SpecForm({
  candidateId,
  onSaved,
  onCancel,
}: {
  candidateId: string;
  onSaved: (spec: SpecRecord) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const input: SpecInput = {
      material: text("material"),
      dimensions: text("dimensions"),
      packaging: text("packaging"),
      requirements: text("requirements"),
      requestedQuantity: Number(text("requestedQuantity")),
      source: text("source"),
    };
    setBusy(true);
    setError(false);
    try {
      onSaved(await createSpec(candidateId, input));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const fields = [
    ["material", "재질", "Material"],
    ["dimensions", "치수·단위", "Dimensions & units"],
    ["packaging", "포장 구성", "Packaging"],
    ["requirements", "품질·인증 요구", "Quality & certification requirements"],
    ["source", "사양 근거·자료명", "Specification source / reference"],
  ] as const;
  return (
    <form className="card sourcing-form" onSubmit={submit}>
      <header className="stack">
        <h2>{t("같은 사양으로 비교하기", "Compare the same specification")}</h2>
        <p className="muted">
          {t(
            "저장한 사양은 그대로 보존합니다. 조건이 바뀌면 새 버전으로 기록하세요.",
            "Saved specifications are preserved. Create a new revision when the requirements change.",
          )}
        </p>
      </header>
      <fieldset disabled={busy} className="form-grid">
        {fields.map(([name, ko, en]) => (
          <div className="field" key={name}>
            <label htmlFor={`spec-${name}`}>{t(ko, en)}</label>
            <input id={`spec-${name}`} name={name} required maxLength={2000} />
          </div>
        ))}
        <div className="field">
          <label htmlFor="spec-quantity">
            {t("요청 수량", "Requested quantity")}
          </label>
          <input
            id="spec-quantity"
            name="requestedQuantity"
            type="number"
            min="1"
            max="10000000"
            step="1"
            required
          />
        </div>
      </fieldset>
      {error && (
        <p className="banner" role="alert">
          {t(
            "저장하지 못했어요. 입력과 연결을 확인해 주세요.",
            "Couldn’t save. Check the inputs and connection.",
          )}
        </p>
      )}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy}>
          {busy
            ? t("저장 중", "Saving")
            : t("비교 사양 저장", "Save specification")}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          {t("취소", "Cancel")}
        </button>
      </div>
    </form>
  );
}
