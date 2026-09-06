export const STAGES = [
  "imported",
  "screening",
  "api_validation",
  "sourcing",
  "rfq_draft",
  "awaiting_contact_approval",
  "sending_rfq",
  "awaiting_quote",
  "economics_review",
  "awaiting_order_decision",
  "decision_recorded",
  "rejected",
] as const;

export type Stage = (typeof STAGES)[number];

export const BLOCKED_REASONS = [
  "web_session",
  "budget",
  "credential",
  "evidence",
  "external_outcome_unknown",
  "provider_unavailable",
] as const;

export type BlockedReason = (typeof BLOCKED_REASONS)[number] | null;

export const STAGE_LABEL_KO: Record<Stage, string> = {
  imported: "가져옴",
  screening: "선별 중",
  api_validation: "공식 확인 중",
  sourcing: "공급처 찾는 중",
  rfq_draft: "견적 초안",
  awaiting_contact_approval: "연락 승인 대기",
  sending_rfq: "견적 요청 보내는 중",
  awaiting_quote: "견적 대기",
  economics_review: "손익 검토",
  awaiting_order_decision: "발주 판단 대기",
  decision_recorded: "결정 기록됨",
  rejected: "탈락",
};

export const STAGE_LABEL_EN: Record<Stage, string> = {
  imported: "Imported",
  screening: "Screening",
  api_validation: "Official checks",
  sourcing: "Finding suppliers",
  rfq_draft: "Quote draft",
  awaiting_contact_approval: "Waiting to send",
  sending_rfq: "Sending quote request",
  awaiting_quote: "Waiting for quotes",
  economics_review: "Economics review",
  awaiting_order_decision: "Waiting for order decision",
  decision_recorded: "Decision recorded",
  rejected: "Rejected",
};
