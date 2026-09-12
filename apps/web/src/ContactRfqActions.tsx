import { NavLink } from "react-router";
import type { RfqRecord } from "../../../packages/domain/src/rfq.ts";
import { Icon, useLocale } from "./ui.tsx";
export function ContactRfqActions({
  candidateId,
  rfq,
  busy,
  contactReady,
  requestApproval,
  decide,
}: {
  candidateId: string;
  rfq: RfqRecord;
  busy: boolean;
  contactReady: boolean;
  requestApproval: () => Promise<void>;
  decide: (decision: "approve" | "reject") => Promise<void>;
}) {
  const { t } = useLocale();
  switch (rfq.state) {
    case "draft":
      return (
        <div className="contact-actions">
          <button
            className="btn btn-primary"
            disabled={busy || !contactReady}
            onClick={() => void requestApproval()}
          >
            {busy
              ? t("요청 중", "Requesting")
              : t("승인 요청", "Request approval")}
          </button>
          {!contactReady && (
            <p className="muted">
              {t(
                "공식 검증 완료 뒤에만 요청할 수 있어요.",
                "Available only after official validation.",
              )}
            </p>
          )}
        </div>
      );
    case "pending_approval":
      return (
        <div className="contact-actions">
          <button
            className="btn btn-primary"
            disabled={busy || !rfq.approvalId}
            onClick={() => void decide("approve")}
          >
            {busy
              ? t("처리 중", "Processing")
              : t("견적 요청 전송 승인", "Approve sending this request")}
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy || !rfq.approvalId}
            onClick={() => void decide("reject")}
          >
            {t("거절", "Reject")}
          </button>
        </div>
      );
    case "awaiting_quote":
      return (
        <NavLink
          className="btn btn-primary"
          to={`/sourcing?candidate=${encodeURIComponent(candidateId)}&spec=${encodeURIComponent(rfq.specId)}`}
        >
          {t("견적 조건 기록·비교", "Record & compare quote terms")}
          <Icon name="arrow" />
        </NavLink>
      );
    case "outcome_unknown":
      return (
        <p className="banner">
          {t(
            "발송 결과가 미확인입니다. 자동 재전송하지 않습니다.",
            "Delivery outcome is unknown. No automatic resend will occur.",
          )}
        </p>
      );
    case "approved":
      return (
        <div className="contact-actions">
          <p className="muted">
            {t(
              "승인된 요청이 전송을 기다리고 있어요.",
              "The approved request is waiting to send.",
            )}
          </p>
          <button
            className="btn btn-secondary"
            disabled={busy || !rfq.approvalId}
            onClick={() => void decide("reject")}
          >
            {t("발송 전 승인 취소", "Cancel before sending")}
          </button>
        </div>
      );
    case "sending":
      return (
        <p className="muted">
          {t(
            "승인된 요청을 처리 중입니다. 위의 연결·전송 상태를 확인하세요.",
            "Processing the approved request. Check the connection and delivery state above.",
          )}
        </p>
      );
    case "rejected":
    case "stale":
      return (
        <p className="muted">
          {t(
            "내용을 고치려면 공급처 추가·새 요청 작성에서 다시 작성하세요.",
            "Use Add suppliers or compose a new request to revise the message.",
          )}
        </p>
      );
    default: {
      const impossible: never = rfq.state;
      return impossible;
    }
  }
}
