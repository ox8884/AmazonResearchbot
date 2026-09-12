import type { InboxQuotePreview } from "../../../packages/domain/src/quote-preview.ts";
import { useState } from "react";
import type {
  CostEvidence,
  CostField,
} from "../../../packages/domain/src/sourcing.ts";
import { costLabels } from "./quote-fields.ts";
import { useLocale } from "./ui.tsx";
export function CostEntry({
  field,
  initial,
  locked = false,
  estimateOnly = false,
}: {
  field: CostField;
  initial?: CostEvidence;
  locked?: boolean;
  estimateOnly?: boolean;
}) {
  const { t } = useLocale();
  const [amount, setAmount] = useState(initial?.value ?? "");
  const [kind, setKind] = useState<"measured" | "estimate" | "quote">(
    initial && initial.kind !== "unknown" ? initial.kind : "estimate",
  );
  return (
    <div className="cost-entry">
      <label htmlFor={`amount-${field}`}>{t(...costLabels[field])}</label>
      <div className="cost-controls">
        <input
          id={`amount-${field}`}
          name={`amount-${field}`}
          aria-label={`${t(...costLabels[field])} (USD)`}
          inputMode="decimal"
          pattern="[0-9]+(\.[0-9]{1,6})?"
          maxLength={24}
          placeholder={t("미확인", "Unknown")}
          value={amount}
          readOnly={locked}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select
          name={locked ? undefined : `kind-${field}`}
          aria-label={`${t("근거 분류", "Evidence type")} · ${t(...costLabels[field])}`}
          disabled={locked || !amount.trim()}
          value={amount.trim() ? kind : "unknown"}
          onChange={(e) => {
            const k = e.target.value;
            if (k === "measured" || k === "estimate" || k === "quote")
              setKind(k);
          }}
        >
          <option value="unknown" disabled>
            {t("미확인", "Unknown")}
          </option>
          <option value="estimate">{t("추정", "Estimate")}</option>
          <option value="quote" disabled={estimateOnly}>
            {t("견적", "Quote")}
          </option>
          <option value="measured" disabled={estimateOnly}>
            {t("측정", "Measured")}
          </option>
        </select>
        {locked && <input type="hidden" name={`kind-${field}`} value={kind} />}
      </div>
    </div>
  );
}

function localTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, -1);
}
export function QuoteSourceFields({
  busy,
  initial,
}: {
  busy: boolean;
  initial?: InboxQuotePreview;
}) {
  const { t } = useLocale();
  const base = initial?.quote;
  return (
    <fieldset className="form-grid" disabled={busy}>
      <div className="field">
        <label htmlFor="supplierName">
          {t("공급처 이름", "Supplier name")}
        </label>
        <input
          name="supplierName"
          id="supplierName"
          required
          maxLength={200}
          defaultValue={initial?.supplierName ?? base?.supplierName ?? ""}
          readOnly={Boolean(initial?.supplierName)}
        />
      </div>
      <div className="field">
        <label htmlFor="supplierSource">
          {t("공급처 출처·자료명", "Supplier source / reference")}
        </label>
        <input
          name="supplierSource"
          id="supplierSource"
          readOnly={Boolean(initial)}
          defaultValue={base?.supplierSource ?? initial?.supplierSource ?? ""}
          required
          maxLength={2000}
          placeholder={t(
            "업체 페이지 주소 또는 받은 자료명",
            "Supplier page or received document",
          )}
        />
      </div>
      <div className="field">
        <label htmlFor="quote-quantity">
          {t("이 단가의 수량", "Quantity at this price")}
        </label>
        <input
          name="quantity"
          id="quote-quantity"
          defaultValue={initial?.quantity ?? base?.quantity ?? ""}
          readOnly={initial?.quantity != null}
          type="number"
          min="1"
          max="10000000"
          step="1"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="quote-moq">
          {t("최소 주문 수량 (MOQ)", "Minimum order quantity (MOQ)")}
        </label>
        <input
          name="moq"
          id="quote-moq"
          defaultValue={initial?.moq ?? base?.moq ?? ""}
          readOnly={initial?.moq != null}
          type="number"
          min="1"
          max="10000000"
          step="1"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="incoterm">
          {t("운송 조건·포함 범위", "Incoterm / shipping scope")}
        </label>
        <input
          name="incoterm"
          id="incoterm"
          defaultValue={initial?.incoterm ?? base?.incoterm ?? ""}
          readOnly={initial?.incoterm != null}
          required
          maxLength={200}
          placeholder="FOB / DDP …"
        />
      </div>
      <div className="field">
        <label htmlFor="receivedAt">
          {t("자료 확인 시각 · 현재 시간대", "Observed at · local time")}
        </label>
        <input
          name="receivedAt"
          id="receivedAt"
          defaultValue={localTimestamp(initial?.receivedAt ?? base?.receivedAt)}
          readOnly={initial?.receivedAt != null}
          step="0.001"
          type="datetime-local"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="validUntil">
          {t(
            "견적 유효일 · 모르면 비워두기",
            "Valid until · leave blank if unknown",
          )}
        </label>
        <input
          name="validUntil"
          id="validUntil"
          type="date"
          defaultValue={initial?.validUntil ?? base?.validUntil ?? ""}
          readOnly={Boolean(initial)}
        />
      </div>
      <div className="field full-width">
        <label htmlFor="sourceText">
          {initial
            ? t(
                "운영자가 추가하는 비용 근거",
                "Operator-provided cost evidence",
              )
            : t("견적 원문·비용별 근거", "Quote source text and cost evidence")}
        </label>
        <textarea
          id="sourceText"
          defaultValue={initial?.operatorEvidence ?? ""}
          name="sourceText"
          rows={4}
          required={!initial}
          maxLength={10000}
          placeholder={
            initial
              ? t(
                  "수수료·광고·반품 등 추가 입력의 근거를 남기세요. 공급처 원문은 별도로 보존됩니다.",
                  "Add evidence for fees, ads, returns, and other entries. The supplier original is preserved separately.",
                )
              : t(
                  "견적 원문과 수수료·광고·반품 예상 비용의 근거를 함께 남기세요. 0원인 항목도 이유가 필요합니다.",
                  "Keep the quote text and evidence for fees, ads, and expected returns. Explain explicit zero costs too.",
                )
          }
        />
      </div>
    </fieldset>
  );
}
