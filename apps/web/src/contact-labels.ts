import type {
  RfqState,
  SupplierRecord,
} from "../../../packages/domain/src/rfq.ts";
import { ContactRequestError } from "./contact-api.ts";

type Labels = readonly [string, string];

const stateLabels: Readonly<Record<RfqState, Labels>> = {
  draft: ["초안", "Draft"],
  pending_approval: ["승인 대기", "Pending approval"],
  approved: ["승인됨 · 발송 대기", "Approved · waiting to send"],
  sending: ["발송 처리 중", "Sending"],
  awaiting_quote: ["견적 회신 대기", "Awaiting quote"],
  outcome_unknown: ["발송 결과 미확인", "Delivery outcome unknown"],
  rejected: ["승인 거절됨", "Rejected"],
  stale: ["기준 변경으로 오래된 초안", "Stale after criteria change"],
};

const supplierMatchLabels: Readonly<
  Record<SupplierRecord["matchStatus"], Labels>
> = {
  matches: ["사양 일치", "Specification matches"],
  mismatch: ["사양 불일치", "Specification mismatch"],
  unknown: ["사양 미확인", "Specification unknown"],
};

export function contactLabel(labels: Labels, language: string): string {
  return labels[language === "ko" ? 0 : 1];
}

export function rfqStateLabel(state: RfqState, language: string): string {
  return contactLabel(stateLabels[state], language);
}

export function supplierMatchLabel(
  supplier: SupplierRecord,
  language: string,
): string {
  if (supplier.matchStatus === "matches" && !supplier.specId)
    return contactLabel(
      [
        "일치 기록 · 사양 버전 미확인",
        "Match recorded · specification version unknown",
      ],
      language,
    );
  return contactLabel(supplierMatchLabels[supplier.matchStatus], language);
}

export function contactDate(value: string, language: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(language === "ko" ? "ko-KR" : "en-US");
}

const reasonLabels: Readonly<Record<string, Labels>> = {
  RFQ_SOURCE_STALE: [
    "확인한 사양이 바뀌었습니다. 현재 사양과 공급처 일치 근거를 다시 확인해 주세요.",
    "The reviewed specification changed. Recheck the supplier against the current specification.",
  ],
  AI_RFQ_STALE: [
    "AI 원본·사양·수량이 바뀌었습니다. 현재 문안을 다시 불러오거나 기본 문안으로 작성해 주세요.",
    "The AI source, specification, or quantity changed. Reload the wording or use the standard template.",
  ],
  MAIL_SMTP_CREDENTIALS_REJECTED: [
    "메일 서버가 로그인 정보를 거절해 사용을 중지했습니다. 업무 메일 설정을 확인해 주세요.",
    "Mail use was disabled after the server rejected the credentials. Check Work email settings.",
  ],
  MAIL_SMTP_SENDER_REJECTED: [
    "보내는 주소가 거절되어 메일 사용을 중지했습니다. 업무 메일 설정을 확인해 주세요.",
    "Mail use was disabled after the sender address was rejected. Check Work email settings.",
  ],
  MAIL_SMTP_RECIPIENT_REJECTED: [
    "수신 주소가 거절되었습니다. 발송 승인을 취소하고 주소를 확인해 새 요청을 작성하세요.",
    "The recipient was rejected. Cancel this approval, check the address, and compose a new request.",
  ],
  MAIL_PROFILE_CHANGED: [
    "메일 설정이 바뀌어 발송을 기다립니다.",
    "Waiting because the mail configuration changed.",
  ],
  MAIL_SMTP_TARGET_DENIED: [
    "메일 서버 주소를 안전하게 확인하지 못했습니다.",
    "The mail server address could not be safely verified.",
  ],
  MAIL_SMTP_CREDENTIALS_UNAVAILABLE: [
    "메일 로그인 정보를 확인해야 합니다.",
    "Check the mail sign-in credentials.",
  ],
  MAIL_SMTP_PRECHECK_FAILED: [
    "메일 서버 연결을 확인하지 못했습니다.",
    "Could not verify the mail server connection.",
  ],
  MAIL_SMTP_CLIENT_UNAVAILABLE: [
    "메일 연결을 준비하지 못했습니다.",
    "Could not prepare the mail connection.",
  ],

  VALIDATION_REQUIRED: [
    "현재 기준으로 공식 확인을 마친 뒤 연락을 승인할 수 있어요.",
    "Complete official checks under the current criteria before approving contact.",
  ],
  STAGE_NOT_READY: [
    "현재 단계의 확인을 먼저 마쳐 주세요.",
    "Finish the checks for the current stage first.",
  ],
  CANDIDATE_MISSING: [
    "후보를 찾을 수 없어요.",
    "The candidate is unavailable.",
  ],
  budget: [
    "확인 예산이 없어 기다리고 있어요.",
    "Waiting for an approved checking budget.",
  ],
  credential: [
    "연결 정보를 기다리고 있어요.",
    "Waiting for connection details.",
  ],
  evidence: [
    "필요한 근거 확인을 기다리고 있어요.",
    "Waiting for the required evidence.",
  ],
  web_session: [
    "로그인된 웹 연결을 기다리고 있어요.",
    "Waiting for the signed-in browser.",
  ],
  provider_unavailable: [
    "현재 연결을 사용할 수 없어요.",
    "The connection is unavailable.",
  ],
  external_outcome_unknown: [
    "보냈는지 확인 중입니다. 다시 보내지 않습니다.",
    "Checking whether it was sent. It will not be resent.",
  ],
  MAIL_NOT_CONFIGURED: [
    "메일 연결을 기다리고 있어요.",
    "Waiting for the mail connection.",
  ],
  MAILPIT_SYNTHETIC_RECIPIENT_REQUIRED: [
    "로컬 테스트에서는 합성 수신 주소만 사용할 수 있어요.",
    "Local tests require synthetic recipient addresses.",
  ],
  APPROVAL_STALE: [
    "승인 내용이나 기준을 다시 확인해 주세요.",
    "Review the approval contents and current criteria again.",
  ],
  DELIVERY_PERSISTENCE_UNCONFIRMED: [
    "발송 결과 저장이 완료되지 않아 수신 원본을 확인 중입니다.",
    "Delivery storage was interrupted; checking the original receipt.",
  ],
  WORKER_RESTARTED_DURING_SEND: [
    "작업이 재시작되어 수신 원본을 확인 중입니다.",
    "The worker restarted; checking the original delivery record.",
  ],
  SMTP_OUTCOME_UNKNOWN: [
    "메일 수락 여부를 아직 확인하지 못했어요.",
    "Mail acceptance has not been confirmed.",
  ],
  SMTP_RECEIPT_UNCONFIRMED: [
    "수신 확인 기록을 대조하고 있어요.",
    "Checking the delivery receipt.",
  ],
  DELIVERY_OUTCOME_UNKNOWN: [
    "발송 결과를 확인 중입니다. 자동 재전송하지 않습니다.",
    "Checking the delivery result. No automatic resend.",
  ],
};
export function contactReason(
  code: string | null | undefined,
  language: string,
): string {
  return contactLabel(
    reasonLabels[code ?? ""] ?? [
      "연락 준비 상태를 추가로 확인해야 합니다.",
      "Further checks are needed before contact.",
    ],
    language,
  );
}
export function deliveryStateLabel(
  state: string | null | undefined,
  language: string,
): string {
  const labels: Record<string, Labels> = {
    approved: ["발송 대기", "Waiting to send"],
    blocked: ["연결 대기", "Waiting for connection"],
    dispatching: ["발송 결과 확인 중", "Confirming delivery"],
    sent: ["수신 확인됨", "Delivery confirmed"],
    outcome_unknown: [
      "결과 미확인 · 재전송 안 함",
      "Outcome unknown · no resend",
    ],
    cancelled: ["발송 취소됨", "Delivery cancelled"],
  };
  return contactLabel(
    state
      ? (labels[state] ?? [
          "전송 상태 확인 필요",
          "Delivery state needs review",
        ])
      : ["전송 시도 없음", "No delivery attempt"],
    language,
  );
}

export function contactActionError(error: unknown, language: string): string {
  if (
    error instanceof ContactRequestError &&
    ["AI_RFQ_STALE", "RFQ_SOURCE_STALE"].includes(error.code)
  )
    return contactReason(error.code, language);
  if (
    error instanceof ContactRequestError &&
    error.code === "CONTACT_NOT_READY"
  )
    return language === "ko"
      ? "현재 공식 검증이 완료되지 않아 승인 요청을 만들 수 없습니다."
      : "Current official validation is required before requesting approval.";
  return language === "ko"
    ? "요청 결과를 확인하지 못했어요. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요."
    : "Couldn’t confirm the request. Refresh the list before trying again.";
}

export function contactSaveError(error: unknown, language: string): string {
  if (
    error instanceof ContactRequestError &&
    ["AI_RFQ_STALE", "RFQ_SOURCE_STALE"].includes(error.code)
  )
    return contactReason(error.code, language);
  if (error instanceof ContactRequestError && error.status === 400)
    return language === "ko"
      ? "입력 형식과 필수 정보를 확인해 주세요."
      : "Check the required fields and input format.";
  return language === "ko"
    ? "저장 결과를 확인하지 못했어요. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요."
    : "Couldn’t confirm the save. Refresh the list before trying again.";
}
