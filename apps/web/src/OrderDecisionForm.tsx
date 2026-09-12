import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  EconomicsAssessment,
  QuoteRecord,
} from "../../../packages/domain/src/sourcing.ts";
import type { OrderDecision } from "../../../packages/domain/src/order.ts";
import type { OrderRiskReview } from "../../../packages/domain/src/order-risk-review.ts";
import { createOrderPacket, OrderRequestError } from "./order-api.ts";
import { getRepresentative } from "./representative-api.ts";
import { Icon, useLocale } from "./ui.tsx";

const RISK_KEYS = ["brand", "returns", "selling"] as const;
type RiskKey = (typeof RISK_KEYS)[number];
type RiskStatus = OrderRiskReview["checks"][RiskKey]["status"];
type RiskDraft = {
  readonly status: RiskStatus;
  readonly source: string;
  readonly observedOn: string;
};

const RISK_LABELS: Readonly<Record<RiskKey, readonly [string, string]>> = {
  brand: ["브랜드 소유권", "Brand ownership"],
  returns: ["실제 반품률", "Actual return rate"],
  selling: ["판매자 제한", "Seller restrictions"],
};

const emptyRiskDraft = (): Record<RiskKey, RiskDraft> => ({
  brand: { status: "unknown", source: "", observedOn: "" },
  returns: { status: "unknown", source: "", observedOn: "" },
  selling: { status: "unknown", source: "", observedOn: "" },
});

function outcomeLabel(
  outcome: EconomicsAssessment["outcome"],
  language: string,
): string {
  switch (outcome) {
    case "GO":
      return "GO";
    case "CAUTION":
      return language === "ko" ? "주의" : "Caution";
    case "HOLD":
      return language === "ko" ? "보류" : "Hold";
    default: {
      const impossible: never = outcome;
      return impossible;
    }
  }
}

function outcomeClass(outcome: EconomicsAssessment["outcome"]): string {
  switch (outcome) {
    case "GO":
      return "ok";
    case "CAUTION":
      return "warn";
    case "HOLD":
      return "unknown";
    default: {
      const impossible: never = outcome;
      return impossible;
    }
  }
}

export function OrderDecisionForm({
  candidateId,
  quotes,
  marketReady,
  onRecorded,
}: {
  candidateId: string;
  quotes: readonly QuoteRecord[];
  marketReady: boolean;
  onRecorded: () => Promise<void>;
}) {
  const { language, t } = useLocale();
  const [quoteId, setQuoteId] = useState(quotes[0]?.id ?? "");
  const [decision, setDecision] = useState<OrderDecision>("hold");
  const [note, setNote] = useState("");
  const [risk, setRisk] = useState<Record<RiskKey, RiskDraft>>(emptyRiskDraft);
  const selectedQuote = quotes.find((quote) => quote.id === quoteId) ?? quotes[0];
  const representative = useQuery({
    queryKey: ["representative", candidateId],
    queryFn: () => getRepresentative(candidateId),
    retry: false,
    enabled: decision === "go",
  });
  const representativeAsin =
    representative.data?.selectedAsin ?? null;
  const riskComplete = RISK_KEYS.every((key) => {
    const check = risk[key];
    return (
      check.status !== "unknown" &&
      check.source.trim().length > 0 &&
      check.observedOn.length > 0
    );
  });
  const riskReady =
    riskComplete && RISK_KEYS.every((key) => risk[key].status === "clear");
  const canGo=marketReady&&selectedQuote?.assessment.outcome==='GO';
  const goReady = canGo && riskReady;
  useEffect(()=>{if(decision==='go'&&!canGo)setDecision('hold');},[decision,canGo]);
  useEffect(()=>{if(decision!=='go')setRisk(emptyRiskDraft());},[decision]);

  useEffect(() => {
    if (!selectedQuote) {
      setQuoteId("");
      return;
    }
    setQuoteId(selectedQuote.id);
  }, [selectedQuote]);

  const create = useMutation({
    mutationFn: (input: {
      readonly quoteId: string;
      readonly decision: OrderDecision;
      readonly note: string;
    }) => createOrderPacket(candidateId, input),
    onSuccess: async () => {
      setNote("");
      await onRecorded();
    },
  });

  if (!selectedQuote)
    return (
      <section className="empty">
        <h2>{t("아직 견적이 없어요", "No quotes yet")}</h2>
        <p className="muted">
          {t(
            "견적을 기록한 뒤 그 사양과 비용 근거를 기준으로 발주 판단을 남길 수 있어요.",
            "Record a quote before recording an order decision from its specification and cost evidence.",
          )}
        </p>
        <NavLink
          className="btn btn-primary"
          to={`/sourcing?candidate=${encodeURIComponent(candidateId)}`}
        >
          {t("견적 기록·비교", "Record & compare quotes")}
          <Icon name="arrow" />
        </NavLink>
      </section>
    );

  const totals = selectedQuote.assessment.totals;
  return (
    <form
      className="order-create stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selectedQuote || !note.trim() || create.isPending || (decision==='go'&&!goReady)) return;
        create.mutate({
          quoteId: selectedQuote.id,
          decision,
          note: note.trim(),
          ...(decision==='go'
            ? {
                riskReview: {
                  kind: "operator_record" as const,
                  scope: {
                    inputVersion: representative.data?.inputVersion ?? 1,
                    representativeAsin,
                    specId: selectedQuote.specId,
                  },
                  checks: {
                    brand: {
                      status: risk.brand.status,
                      source: risk.brand.source.trim(),
                      observedOn: risk.brand.observedOn,
                    },
                    returns: {
                      status: risk.returns.status,
                      source: risk.returns.source.trim(),
                      observedOn: risk.returns.observedOn,
                    },
                    selling: {
                      status: risk.selling.status,
                      source: risk.selling.source.trim(),
                      observedOn: risk.selling.observedOn,
                    },
                  },
                  recordedOn: new Date().toISOString().slice(0, 10),
                },
              }
            : {}),
        });
      }}
    >
      <header className="section-label">
        <h2>{t("새 발주 판단 기록", "Record a new order decision")}</h2>
        <p className="muted">
          {t(
            "결정과 출시 현금 예약을 기록할 뿐, 주문·결제·공급처 전송은 하지 않습니다.",
            "This records a decision and launch-cash reservation only. It does not order, pay, or contact a supplier.",
          )}
        </p>
      </header>
      <div className="field">
        <label htmlFor="order-quote">{t("기준 견적", "Quote to review")}</label>
        <select
          id="order-quote"
          disabled={create.isPending}
          value={selectedQuote.id}
          onChange={(event) => setQuoteId(event.target.value)}
        >
          {quotes.map((quote, index) => (
            <option key={quote.id} value={quote.id}>
              {index + 1} · {quote.supplierName}
            </option>
          ))}
        </select>
      </div>
      <section className="order-quote-summary" aria-label={t("선택한 견적", "Selected quote")}>
        <div className="quote-heading">
          <strong>{selectedQuote.supplierName}</strong>
          <span className={`chip chip-${outcomeClass(selectedQuote.assessment.outcome)}`}>
            {t('견적','Quote')} · {outcomeLabel(selectedQuote.assessment.outcome, language)}
          </span>
        </div>
        <p className="muted">{t("수량 / MOQ", "Quantity / MOQ")}: {selectedQuote.quantity} / {selectedQuote.moq}</p>
        {totals ? (
          <dl className="order-values">
            <div>
              <dt>{t("출시 현금", "Launch cash")}</dt>
              <dd>USD {totals.launchCash}</dd>
            </div>
            <div>
              <dt>{t("광고 후 마진", "After-ads margin")}</dt>
              <dd>{totals.marginAfterAdsPct}%</dd>
            </div>
          </dl>
        ) : (
          <p className="banner">
            {t(
              "미확인 비용이 있어 계산할 수 없습니다 · 보류",
              "Unknown costs prevent a calculation · Hold",
            )}
          </p>
        )}
      </section>
      {!canGo&&<p className="banner">{t('GO 기록에는 현재 공식 평가, 시장 조건, 견적 수익성이 모두 충족되어야 합니다. 보류나 탈락 판단은 기록할 수 있습니다.','GO requires current official validation, market criteria and quote economics to be met. You can still record a hold or rejection.')}</p>}
      <fieldset className="order-decision-fieldset">
        <legend>{t("기록할 판단", "Decision to record")}</legend>
        <div className="order-decisions">
          {(["go", "hold", "reject"] as const).map((value) => (
            <label className="order-decision" key={value}>
              <input
                checked={decision === value}
                disabled={create.isPending||(value==='go'&&!canGo)}
                name="order-decision"
                type="radio"
                value={value}
                onChange={() => setDecision(value)}
              />
              {value === "go"
                ? t("GO 기록", "Record GO")
                : value === "hold"
                  ? t("보류 기록", "Record hold")
                  : t("탈락 기록", "Record rejection")}
            </label>
          ))}
        </div>
      </fieldset>
      {decision==='go'&&(
        <section className="order-risk-review" aria-labelledby="order-risk-heading">
          <header className="section-label">
            <h3 id="order-risk-heading">{t('발주 전 위험 확인','Risk checks before GO')}</h3>
            <p className="muted">
              {t('세 항목 모두 근거와 확인 날짜가 있어야 GO를 기록할 수 있습니다. 미확인은 0으로 바꾸지 않고 그대로 남깁니다.','All three checks need a source and date before GO. Unknown values stay unknown.')}
            </p>
          </header>
          {representative.isSuccess&&(
            <p className="muted">
              {t('대표 ASIN','Representative ASIN')}: <strong>{representativeAsin??t('아직 선택하지 않음','Not selected')}</strong>
            </p>
          )}
          {RISK_KEYS.map(key=>{
            const check=risk[key];
            return (
              <div className="order-risk-row" key={key}>
                <fieldset className="order-decision-fieldset">
                  <legend>{t(RISK_LABELS[key][0],RISK_LABELS[key][1])}</legend>
                  <div className="order-decisions">
                    {([['clear',t('문제 없음','Clear')],['risk',t('위험 있음','Risk')],['unknown',t('미확인','Unknown')]] as const).map(([value,label])=>(
                      <label className="order-decision" key={value}>
                        <input
                          checked={check.status===value}
                          disabled={create.isPending}
                          name={`order-risk-${key}`}
                          type="radio"
                          onChange={()=>setRisk(previous=>({...previous,[key]:{...previous[key],status:value}}))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {check.status!=='unknown'&&(
                  <div className="order-risk-evidence">
                    <div className="field">
                      <label htmlFor={`order-risk-source-${key}`}>{t('근거 출처','Source')}</label>
                      <input
                        id={`order-risk-source-${key}`}
                        required
                        value={check.source}
                        onChange={event=>setRisk(previous=>({...previous,[key]:{...previous[key],source:event.target.value}}))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`order-risk-date-${key}`}>{t('확인 날짜','Date observed')}</label>
                      <input
                        id={`order-risk-date-${key}`}
                        required
                        type="date"
                        value={check.observedOn}
                        onChange={event=>setRisk(previous=>({...previous,[key]:{...previous[key],observedOn:event.target.value}}))}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {canGo&&!riskReady&&(
            <p className="banner">
              {t('위험 확인이 끝나지 않았습니다. 모두 “문제 없음”이고 근거·날짜가 있어야 GO를 기록할 수 있습니다. 그 전까지는 보류나 탈락으로 기록하세요.','Risk checks are incomplete. Every check must be “Clear” with a source and date before recording GO. Until then, record a hold or rejection.')}
            </p>
          )}
        </section>
      )}
      <div className="field">
        <label htmlFor="order-note">{t("판단 근거", "Decision note")}</label>
        <textarea
          id="order-note"
          required
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <button className="btn btn-primary" disabled={create.isPending||(decision==='go'&&!goReady)}>
        {create.isPending
          ? t("기록 중", "Recording")
          : t("판단 승인 요청", "Request decision approval")}
      </button>
      {create.isError && (
        <p className="banner" role="alert">
          {create.error instanceof OrderRequestError &&
          create.error.code === "SETTINGS_REQUIRED" ? (
            <>
              {t(
                "필수 사업 설정을 먼저 완성해야 합니다. 저장된 변경 요청을 검토하되, 이 화면에서는 승인하지 않습니다.",
                "Complete the required business settings first. Review the saved change request; this screen will not approve it.",
              )}{" "}
              <NavLink to="/settings">{t("설정 열기", "Open settings")}</NavLink>
            </>
          ) : (
            t(
              "판단 기록을 만들지 못했어요. 현재 견적과 기준을 다시 확인해 주세요.",
              "Couldn’t create the decision record. Check the current quote and criteria.",
            )
          )}
        </p>
      )}
    </form>
  );
}
