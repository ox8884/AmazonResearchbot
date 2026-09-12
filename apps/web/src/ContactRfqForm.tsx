import { SpecProvenance } from "./SpecProvenance.tsx";
import { AiRfqSuggestion } from "./AiRfqSuggestion.tsx";
import { contactSaveError } from "./contact-labels.ts";
import { useEffect, useState, type FormEvent } from "react";
import type { SupplierRecord } from "../../../packages/domain/src/rfq.ts";
import { rfqTemplate } from "../../../packages/domain/src/rfq.ts";
import type { SpecRecord } from "../../../packages/domain/src/sourcing.ts";
import { createRfq } from "./contact-api.ts";
import { useLocale } from "./ui.tsx";

type SaveHandler = () => Promise<void>;


export function ContactRfqForm({
  candidateId,
  product,
  suppliers,
  specs,
  onSaved,
}: {
  candidateId: string;
  product: string;
  suppliers: readonly SupplierRecord[];
  specs: readonly SpecRecord[];
  onSaved: SaveHandler;
}) {
  const { t, language } = useLocale();
  const eligible = suppliers.filter(
    (supplier) => supplier.matchStatus === "matches" && supplier.email !== null,
  );
  const [supplierId, setSupplierId] = useState("");
  const [specId, setSpecId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [templateSubject,setTemplateSubject]=useState("");
  const [aiTaskId,setAiTaskId]=useState<string|null>(null);
  const [aiAppliedBody,setAiAppliedBody]=useState("");
  const [autoAiAllowed,setAutoAiAllowed]=useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const spec = specs.find((item) => item.id === specId) ?? null;

  function applyTemplate(next: SpecRecord, requested = next.requestedQuantity, allowAi = true, preserveSubject = false) {
    const template = rfqTemplate({
      product,
      material: next.material,
      dimensions: next.dimensions,
      packaging: next.packaging,
      requirements: next.requirements,
      quantity: requested,
    });
    setAutoAiAllowed(allowAi);setAiTaskId(null);setAiAppliedBody("");setTemplateSubject(template.subject);
    setSpecId(next.id);
    setQuantity(String(requested));
    if(!preserveSubject)setSubject(template.subject);
    setBody(template.body);
    setTemplateBody(template.body);
  }

  useEffect(() => {
    if (!supplierId && eligible[0]) setSupplierId(eligible[0].id);
  }, [eligible, supplierId]);
  useEffect(() => {
    if (!specId && specs[0]) applyTemplate(specs[0]);
  }, [specId, specs]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supplierId || !spec) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await createRfq(candidateId, {
        supplierId,
        ...(aiTaskId ? {aiTaskId} : {}),
        specId: spec.id,
        quantity: Number(quantity),
        subject: subject.trim(),
        body,
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
        <h2>{t("견적 요청 초안 작성", "Compose RFQ draft")}</h2>
        <p className="muted">
          {t("저장한 초안은 수정하지 않습니다.", "Saved drafts stay immutable.")}{" "}
          <span className="copy-phrase">{t("내용이 바뀌면 새 초안을 저장하세요.", "Save a new draft when the message changes.")}</span>
        </p>
      </header>
      <SpecProvenance aiTaskId={spec?.aiTaskId} />
      {!eligible.length || !specs.length ? (
        <p className="banner">
          {t(
            !specs.length
              ? "먼저 견적 비교 사양을 만들어 주세요."
              : "사양이 일치하고 이메일이 있는 공급처를 등록해 주세요.",
            !specs.length
              ? "Create a comparison specification first."
              : "Register a matching supplier with an email address first.",
          )}
        </p>
      ) : (
        <fieldset disabled={busy}>
          <div className="contact-form-grid">
            <div className="field">
              <label htmlFor="rfq-supplier">
                {t("수신 공급처", "Recipient supplier")}
              </label>
              <select
                id="rfq-supplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
              >
                {eligible.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} · {supplier.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rfq-spec">
                {t("선택 사양", "Selected specification")}
              </label>
              <select
                id="rfq-spec"
                value={specId}
                onChange={(event) => {
                  const next = specs.find(
                    (item) => item.id === event.target.value,
                  );
                  if (next) applyTemplate(next);
                }}
              >
                {specs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.aiTaskId ? t("AI 제안 · ", "AI proposal · ") : ""}r{item.revision} · {item.material} · {item.dimensions}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rfq-quantity">
                {t("요청 수량", "Requested quantity")}
              </label>
              <input
                id="rfq-quantity"
                type="number"
                min="1"
                max="10000000"
                value={quantity}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuantity(value);
                  if(aiTaskId&&body===aiAppliedBody&&spec&&Number.isInteger(Number(value))&&Number(value)>0){applyTemplate(spec,Number(value),true,true);return;}
                  if (
                    spec &&
                    body === templateBody &&
                    Number.isInteger(Number(value)) &&
                    Number(value) > 0
                  ) {
                    const next = rfqTemplate({
                      product,
                      material: spec.material,
                      dimensions: spec.dimensions,
                      packaging: spec.packaging,
                      requirements: spec.requirements,
                      quantity: Number(value),
                    });
                    setBody(next.body);
                    setTemplateBody(next.body);
                  }
                }}
                required
              />
            </div>
            <div className="contact-template-action">
              <button
                className="text-btn"
                type="button"
                disabled={
                  !quantity ||
                  !Number.isInteger(Number(quantity)) ||
                  Number(quantity) < 1
                }
                onClick={() => spec && applyTemplate(spec, Number(quantity), false, true)}
              >
                {t(
                  "현재 수량으로 본문 다시 작성",
                  "Rewrite with the current quantity",
                )}
              </button>
            </div>
            <AiRfqSuggestion candidateId={candidateId} specId={specId} quantity={Number(quantity)} disabled={busy} autoApply={autoAiAllowed&&!saved&&!aiTaskId&&body===templateBody&&subject===templateSubject} onApply={source=>{setBody(source.body);setAiTaskId(source.aiTaskId);setAiAppliedBody(source.body);}} />
            {aiTaskId&&<p className="muted contact-form-wide">{t('현재 사양의 AI 문안을 바탕으로 작성했습니다. 사양이나 입력 기준이 바뀌면 다시 불러와야 합니다.','Based on AI wording for the current specification. Reload if the specification or input criteria change.')}</p>}
            <div className="field contact-form-wide">
              <label htmlFor="rfq-subject">{t("제목", "Subject")}</label>
              <input
                id="rfq-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="field contact-form-wide">
              {body !== templateBody && body !== aiAppliedBody && (
                <p className="muted">
                  {t(
                    "직접 수정한 본문은 보존합니다. 요청 수량과 본문이 일치하는지 확인해 주세요.",
                    "Your edited message is preserved. Check that its quantity matches the request.",
                  )}
                </p>
              )}
              <label htmlFor="rfq-body">{t("본문", "Message")}</label>
              <textarea
                id="rfq-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={14}
                maxLength={30000}
                required
              />
            </div>
          </div>
        </fieldset>
      )}
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="save-notice" role="status">
          {t("견적 요청 내용을 저장했습니다.", "Quote request saved.")}
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={busy || !eligible.length || !specs.length}
      >
        {busy
          ? t("초안 저장 중", "Saving draft")
          : t("견적 요청 저장", "Save RFQ draft")}
      </button>
    </form>
  );
}
