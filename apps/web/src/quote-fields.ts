import { QuoteRequestError } from "./quote-api.ts";
import type { CostField } from "../../../packages/domain/src/sourcing.ts";
export const costLabels = {
  salePrice: ["판매가", "Sale price"],
  productUnitPrice: ["제품 단가", "Product unit price"],
  unitFreight: ["단위 운임", "Freight per unit"],
  unitDuty: ["단위 관세", "Duty per unit"],
  unitPrepInspection: ["단위 준비·검수비", "Prep / inspection per unit"],
  otherLandedUnitCost: ["기타 도착원가", "Other landed cost per unit"],
  fbaFee: ["FBA 수수료", "FBA fee"],
  referralFee: ["판매 수수료", "Referral fee"],
  adsPerUnit: ["단위 광고비", "Ads per unit"],
  expectedReturnLoss: ["반품·손실 예상", "Expected return / loss"],
  otherVariableCost: ["기타 변동비", "Other variable cost"],
  separateUpfrontCosts: ["별도 선지급 비용", "Separate upfront costs"],
  initialAdCash: ["초기 광고 현금", "Initial ad cash"],
  contingencyCash: ["예비 현금", "Cash reserve"],
} satisfies Record<CostField, readonly [string, string]>;
export const costFields = Object.keys(costLabels) as CostField[];
export function usd(value: string | null | undefined, language: string) {
  if (value === null || value === undefined)
    return language === "ko" ? "미확인" : "Unknown";
  return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
export function quoteReason(reason: string, language: string): string {
  const known: Record<string, readonly [string, string]> = {
    RISK_UNCONFIRMED: [
      "필수 위험 확인이 끝나지 않았습니다.",
      "Required risk checks are incomplete.",
    ],
    QUOTE_VALIDITY_UNKNOWN: [
      "견적 유효일이 미확인입니다.",
      "The quote validity date is unknown.",
    ],
    QUOTE_EXPIRED: ["견적이 만료되었습니다.", "This quote has expired."],
    INVALID_QUANTITY: ["수량을 확인해 주세요.", "Review the quantity."],
    SALE_PRICE_NOT_POSITIVE: [
      "판매가는 0보다 커야 계산할 수 있습니다.",
      "Sale price must be greater than zero.",
    ],
    LANDED_COST_NOT_POSITIVE: [
      "도착원가가 0 이하여서 계산할 수 없습니다.",
      "Landed cost must be greater than zero.",
    ],
    MARGIN_BEFORE_ADS_BELOW_CRITERIA: [
      "광고 전 마진이 현재 기준에 못 미칩니다.",
      "Margin before ads is below the current target.",
    ],
    MARGIN_AFTER_ADS_BELOW_CRITERIA: [
      "광고 후 마진이 현재 기준에 못 미칩니다.",
      "Margin after ads is below the current target.",
    ],
    ROI_BELOW_CRITERIA: [
      "ROI가 현재 기준에 못 미칩니다.",
      "ROI is below the current target.",
    ],
    LAUNCH_CASH_OVER_BUDGET: [
      "출시 현금이 현재 한도를 초과합니다.",
      "Launch cash exceeds the current limit.",
    ],
  };
  const label = known[reason];
  if (label) return label[language === "ko" ? 0 : 1];
  const field = costFields.find((f) =>
    reason.endsWith(f.replace(/[A-Z]/g, (l) => `_${l}`).toUpperCase()),
  );
  if (field) {
    const label = costLabels[field][language === "ko" ? 0 : 1];
    return language === "ko"
      ? `${label}: ${reason.startsWith("UNKNOWN_") ? "미확인" : "입력값 확인 필요"}`
      : `${label}: ${reason.startsWith("UNKNOWN_") ? "unknown" : "review the input"}`;
  }
  return language === "ko"
    ? "평가를 완료하려면 추가 확인이 필요합니다."
    : "Further checks are required to complete this assessment.";
}

export function quoteSaveError(error: unknown, language: string): string {
  const ko = language === "ko";
  if (
    error instanceof QuoteRequestError &&
    ["SOURCE_MISMATCH", "SOURCE_TERMS_CHANGED", "SOURCE_UNAVAILABLE"].includes(
      error.code,
    )
  )
    return ko
      ? "회신에 연결된 사양·수량·단가를 확인해 주세요. 원문 조건을 바꿔 저장할 수 없습니다."
      : "Check the linked specification, quantity, and quoted price. Original supplier conditions cannot be changed here.";
  if (error instanceof QuoteRequestError && error.status === 400)
    return ko
      ? "입력 형식·수량·근거를 확인해 주세요. 금액은 0 이상의 숫자여야 합니다."
      : "Check the format, quantity, and evidence. Amounts must be nonnegative numbers.";
  return ko
    ? "저장 결과를 확인하지 못했어요. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요."
    : "Couldn’t confirm the save. Refresh the list before trying again.";
}
