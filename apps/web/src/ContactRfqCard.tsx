import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { RfqRecord } from "../../../packages/domain/src/rfq.ts";
import { ContactReplies } from "./ContactReplies.tsx";
import { ContactRfqActions } from "./ContactRfqActions.tsx";
import {
  decideRfqApproval,
  getRfqReplies,
  requestRfqApproval,
} from "./contact-api.ts";
import {
  contactActionError,
  contactDate,
  contactReason,
  deliveryStateLabel,
  rfqStateLabel,
} from "./contact-labels.ts";
import { useLocale } from "./ui.tsx";

type Props = {
  readonly candidateId: string;
  readonly contactReady: boolean;
  readonly deliveryMode: "disabled" | "mailpit" | "smtp";
  readonly rfq: RfqRecord;
  readonly specLabel: string;
  readonly onChanged: () => Promise<void>;
};

export function ContactRfqCard({
  candidateId,
  contactReady,
  deliveryMode,
  rfq,
  specLabel,
  onChanged,
}: Props) {
  const { t, language } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const replies = useQuery({
    queryKey: ["rfq-replies", rfq.id],
    queryFn: () => getRfqReplies(rfq.id),
    enabled: replyOpen,
  });

  async function requestApproval() {
    if (busy || !contactReady) return;
    setBusy(true);
    setError(null);
    try {
      await requestRfqApproval(rfq.id);
      await onChanged();
    } catch (caught) {
      setError(contactActionError(caught, language));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (busy || !rfq.approvalId) return;
    setBusy(true);
    setError(null);
    try {
      await decideRfqApproval(rfq.approvalId, decision);
      await onChanged();
    } catch (caught) {
      setError(contactActionError(caught, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card rfq-card">
      <header className="rfq-heading">
        <div className="stack">
          <p className="muted">RFQ r{rfq.revision}</p>
          <h2>{rfq.recipient}</h2>
        </div>
        <span
          className={`chip chip-${rfq.state === "approved" || rfq.state === "awaiting_quote" ? "ok" : rfq.state === "rejected" || rfq.state === "outcome_unknown" ? "warn" : "stage"}`}
        >
          {rfqStateLabel(rfq.state, language)}
        </span>
      </header>
      {rfq.aiTaskId && <p className="muted">{t("AI 문안 기반 · 저장된 원본과 사양 연결됨", "Based on AI wording · linked to the saved source and specification")}</p>}
      <dl className="rfq-details">
        <div>
          <dt>{t("사양 버전", "Specification revision")}</dt>
          <dd>{specLabel}</dd>
        </div>
        <div>
          <dt>{t("요청 수량", "Requested quantity")}</dt>
          <dd>{rfq.quantity}</dd>
        </div>
        <div>
          <dt>{t("저장 시점", "Saved at")}</dt>
          <dd>{contactDate(rfq.createdAt, language)}</dd>
        </div>
        <div>
          <dt>{t("전송 경로", "Delivery transport")}</dt>
          <dd>
            {rfq.deliveryTransport === "mailpit"
              ? t("Mailpit 로컬 캡처", "Mailpit local capture")
              : rfq.deliveryTransport === "smtp-imap"
                ? t("업무 메일", "Work email")
                : (rfq.deliveryTransport && rfq.deliveryTransport !== "disabled") || ["sent", "outcome_unknown", "dispatching"].includes(rfq.deliveryState ?? "")
                  ? t("전송 경로 미확인", "Delivery route unconfirmed")
              : deliveryMode === "disabled"
                ? t("연결 비활성", "Disabled")
                : t("아직 발송하지 않음", "Not sent yet")}
          </dd>
        </div>
        <div>
          <dt>{t("전송 상태", "Delivery state")}</dt>
          <dd>{deliveryStateLabel(rfq.deliveryState, language)}</dd>
        </div>
      </dl>
      {rfq.deliveryReason && (
        <p className="muted">
          {t("전송 사유", "Delivery reason")}:{" "}
          {contactReason(rfq.deliveryReason, language)}
        </p>
      )}
      <section className="rfq-message stack">
        <div>
          <p className="muted">{t("수신자", "Recipient")}</p>
          <p>{rfq.recipient}</p>
        </div>
        <div>
          <p className="muted">{t("제목", "Subject")}</p>
          <p>{rfq.subject}</p>
        </div>
        <div>
          <p className="muted">{t("본문", "Message")}</p>
          <p className="source-text">{rfq.body}</p>
        </div>
      </section>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      <ContactRfqActions
        candidateId={candidateId}
        rfq={rfq}
        busy={busy}
        contactReady={contactReady}
        requestApproval={requestApproval}
        decide={decide}
      />
      <details
        className="reply-details"
        onToggle={(event) => setReplyOpen(event.currentTarget.open)}
      >
        <summary>{t("회신 기록 보기·추가", "View or record replies")}</summary>
        {replyOpen && (
          <ContactReplies
            rfq={rfq}
            replies={replies.data?.replies ?? []}
            loading={replies.isPending}
            error={replies.isError}
            onSaved={async () => {
              await onChanged();
              await replies.refetch();
            }}
          />
        )}
      </details>
    </article>
  );
}
