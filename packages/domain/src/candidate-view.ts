import { STAGE_LABEL_EN, STAGE_LABEL_KO, type BlockedReason, type Stage } from "./stages.ts";

export type NextActionKind = "automatic" | "approval" | "waiting";

export type NextAction = {
  kind: NextActionKind;
  label: string;
  target: string;
};

export type CandidateView = {
  id: string;
  keyword: string;
  stage: Stage;
  stageLabel: string;
  evidenceSummary: string;
  unknowns: string[];
  nextAction: NextAction;
  blockedReason: BlockedReason;
};

export function nextAction(input: {
  stage: Stage;
  blockedReason: BlockedReason;
  locale: "ko" | "en";
}): NextAction {
  const ko = input.locale === "ko";
  if (input.blockedReason === "web_session") {
    return {
      kind: "waiting",
      label: ko ? "웹 연결을 기다리고 있어요" : "Waiting for the signed-in browser",
      target: "web_session",
    };
  }
  if (input.blockedReason === "budget") {
    return {
      kind: "waiting",
      label: ko ? "확인 예산이 없어 호출하지 않습니다" : "No check budget — no calls",
      target: "budget",
    };
  }
  if (input.blockedReason === "credential") {
    return {
      kind: "waiting",
      label: ko ? "연결 정보가 없어 기다립니다" : "Waiting for connection details",
      target: "credential",
    };
  }
  if (input.blockedReason === "evidence") {
    return {
      kind: "waiting",
      label: ko ? "근거가 부족해 확인을 기다립니다" : "Waiting on missing evidence",
      target: "evidence",
    };
  }
  if (input.blockedReason === "external_outcome_unknown") {
    return {
      kind: "waiting",
      label: ko ? "보냈는지 아직 확인 중이에요. 다시 보내지 않습니다" : "Send result unknown. It will not be resent",
      target: "external_outcome_unknown",
    };
  }
  if (input.blockedReason === "provider_unavailable") {
    return {
      kind: "waiting",
      label: ko ? "연결을 사용할 수 없어 기다립니다" : "Provider unavailable",
      target: "provider_unavailable",
    };
  }
  if (input.stage === "awaiting_quote") {
    return { kind: "waiting", label: ko ? "공급처의 견적 회신을 기다립니다" : "Waiting for the supplier’s quote", target: "awaiting_quote" };
  }
  if (input.stage === "awaiting_contact_approval") {
    return {
      kind: "approval",
      label: ko ? "견적 요청 보내기" : "Send quote requests",
      target: "supplier_contact",
    };
  }
  if (input.stage === "awaiting_order_decision") {
    return {
      kind: "approval",
      label: ko ? "발주 판단 보기" : "Review order decision",
      target: "order_decision",
    };
  }
  if (input.stage === "rejected" || input.stage === "decision_recorded") {
    return {
      kind: "waiting",
      label: ko ? "이 후보는 끝났습니다" : "This candidate is finished",
      target: "done",
    };
  }
  return {
    kind: "automatic",
    label: ko ? "자동 확인 중" : "Checking automatically",
    target: input.stage,
  };
}

export function stageLabel(stage: Stage, locale: "ko" | "en"): string {
  return locale === "ko" ? STAGE_LABEL_KO[stage] : STAGE_LABEL_EN[stage];
}
