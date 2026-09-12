import { NavLink } from "react-router";
import type { InboxQuotePreview } from "../../../packages/domain/src/quote-preview.ts";
import { useState, type FormEvent } from "react";
import type {
  CostEvidence,
  CostField,
  QuoteInput,
  QuoteRecord,
} from "../../../packages/domain/src/sourcing.ts";
import { createQuote, createInboxQuote } from "./quote-api.ts";
import { costFields, quoteSaveError } from "./quote-fields.ts";
import { CostEntry, QuoteSourceFields } from "./QuoteFields.tsx";
import { useLocale } from "./ui.tsx";
export function QuoteForm({
  candidateId,
  specId,
  onSaved,
  onCancel,
  prefill,
  blocked = false,
}: {
  candidateId: string;
  specId: string;
  prefill?: InboxQuotePreview;
  blocked?: boolean;
  onSaved: (quote: QuoteRecord) => void;
  onCancel: () => void;
}) {
  const { t, language } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [risk, setRisk] = useState(prefill?.quote?.risksConfirmed ?? false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || blocked) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const receivedAt = new Date(text("receivedAt")).toISOString();
    const cell = (field: CostField): CostEvidence => {
      const value = text(`amount-${field}`);
      const kind = text(`kind-${field}`);
      if (!value) {
        const previous = prefill?.quote?.costs[field];
        if (previous?.kind === "unknown") return previous;
        return {
          value: null,
          kind: "unknown",
          source: null,
          observedAt: null,
          reason: prefill ? "NOT_IN_SUPPLIER_REPLY" : "입력되지 않은 비용",
        };
      }
      if (kind !== "measured" && kind !== "estimate" && kind !== "quote")
        throw new Error("evidence kind");
      const quoted = prefill?.costs[field];
      if (quoted && quoted.value === value && quoted.kind === kind)
        return quoted;
      const previous = prefill?.quote?.costs[field];
      if (
        previous &&
        previous.kind !== "unknown" &&
        previous.value === value &&
        previous.kind === kind &&
        text("sourceText") === prefill?.operatorEvidence?.trim()
      )
        return previous;
      return {
        value,
        kind,
        source: text("sourceText"),
        observedAt: receivedAt,
      };
    };
    const input: QuoteInput = {
      specId,
      supplierName: text("supplierName"),
      supplierSource: text("supplierSource"),
      sourceText: prefill?.bound
        ? prefill.sourceText.trim()
        : text("sourceText"),
      receivedAt,
      validUntil: text("validUntil") || null,
      incoterm: text("incoterm"),
      quantity: Number(text("quantity")),
      moq: Number(text("moq")),
      risksConfirmed: risk,
      riskSource: text("riskSource"),
      costs: {
        salePrice: cell("salePrice"),
        productUnitPrice: cell("productUnitPrice"),
        unitFreight: cell("unitFreight"),
        unitDuty: cell("unitDuty"),
        unitPrepInspection: cell("unitPrepInspection"),
        otherLandedUnitCost: cell("otherLandedUnitCost"),
        fbaFee: cell("fbaFee"),
        referralFee: cell("referralFee"),
        adsPerUnit: cell("adsPerUnit"),
        expectedReturnLoss: cell("expectedReturnLoss"),
        otherVariableCost: cell("otherVariableCost"),
        separateUpfrontCosts: cell("separateUpfrontCosts"),
        initialAdCash: cell("initialAdCash"),
        contingencyCash: cell("contingencyCash"),
      },
    };
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await (prefill?.bound
          ? createInboxQuote(prefill.inboxMessageId, input, text("sourceText"))
          : createQuote(candidateId, input)),
      );
    } catch (e) {
      setError(quoteSaveError(e, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="sourcing-form stack" onSubmit={submit}>
      <header className="stack">
        <h2>{t("견적 기록", "Record a quote")}</h2>
        <p className="muted">
          {t(
            "입력은 저장과 계산만 수행합니다. 업체 연락이나 발주는 실행하지 않습니다.",
            "This only saves and calculates. It does not contact suppliers or place orders.",
          )}
        </p>
      </header>
      {prefill && (
        <div className="banner stack">
          <p>
            {t(
              "회신에 명시된 수량·단가·운송 조건은 그대로 유지합니다. 나머지 비용과 근거를 보완하세요.",
              "Keep the supplier’s stated quantity, price, and shipping terms. Add the remaining costs and evidence.",
            )}
          </p>
          <NavLink
            className="text-btn"
            to={`/inbox/${encodeURIComponent(prefill.inboxMessageId)}`}
          >
            {t("회신 원문 보기", "View original reply")}
          </NavLink>
        </div>
      )}
      <QuoteSourceFields busy={busy} initial={prefill} />
      <fieldset className="cost-fieldset" disabled={busy}>
        <legend>
          {t("단위 비용과 출시 현금 (USD)", "Unit costs and launch cash (USD)")}
        </legend>
        <p className="muted">
          {t(
            "빈칸은 미확인입니다. 입력한 금액은 기본 추정이며, 확인한 자료에 맞게 분류를 바꾸세요.",
            "Blank fields stay unknown. Entered amounts default to estimates; choose the type supported by your source.",
          )}
        </p>
        {costFields.map((field) => (
          <CostEntry
            key={field}
            field={field}
            initial={prefill?.costs[field] ?? prefill?.quote?.costs[field]}
            locked={Boolean(prefill?.costs[field])}
            estimateOnly={Boolean(
              prefill &&
              !prefill.costs[field] &&
              [
                "productUnitPrice",
                "unitFreight",
                "unitDuty",
                "unitPrepInspection",
                "otherLandedUnitCost",
                "separateUpfrontCosts",
              ].includes(field),
            )}
          />
        ))}
        <p className="muted">
          {t(
            "선지급비는 도착원가에 이미 포함한 비용을 빼고 입력하세요. 초기 광고 현금은 단위 광고비와 별개인 출시 운전자금입니다.",
            "Exclude costs already included in landed cost from upfront costs. Initial ad cash funds the launch; it is distinct from ads per unit.",
          )}
        </p>
      </fieldset>
      <fieldset className="risk-confirmation stack" disabled={busy}>
        <legend>{t("필수 위험 확인", "Required risk checks")}</legend>
        <label className="check-label">
          <input
            type="checkbox"
            checked={risk}
            onChange={(e) => setRisk(e.target.checked)}
          />
          {t(
            "포장 규격·수수료·판매 제한 등 필수 위험을 확인했어요",
            "I have checked packaging, fees, selling restrictions, and required risks",
          )}
        </label>
        <p className="muted">
          {t(
            "확인하지 않은 항목이 있으면 체크하지 마세요. 계산 기준을 충족해도 판정은 보류됩니다.",
            "Leave unchecked if any required risk remains unknown. The decision stays on hold even if the numbers meet the targets.",
          )}
        </p>
        {risk && (
          <div className="field">
            <label htmlFor="riskSource">
              {t("위험 확인 자료·결론", "Risk review evidence and conclusion")}
            </label>
            <textarea
              name="riskSource"
              id="riskSource"
              defaultValue={prefill?.quote?.riskSource ?? ""}
              rows={3}
              required
              maxLength={4000}
            />
          </div>
        )}
      </fieldset>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy || blocked}>
          {busy
            ? t("저장 중", "Saving")
            : t("견적 저장·계산", "Save & calculate quote")}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          {t("취소", "Cancel")}
        </button>
      </div>
    </form>
  );
}
