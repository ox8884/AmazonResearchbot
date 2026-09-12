import { NavLink } from "react-router";
import { useState, type FormEvent } from "react";
import type { RfqRecord } from "../../../packages/domain/src/rfq.ts";
import { getRfqReplies, recordRfqReply } from "./contact-api.ts";
import { contactActionError, contactDate } from "./contact-labels.ts";
import { useLocale } from "./ui.tsx";

export function ContactReplies({
  rfq,
  replies,
  loading,
  error,
  onSaved,
}: {
  readonly rfq: RfqRecord;
  readonly replies: Awaited<ReturnType<typeof getRfqReplies>>["replies"];
  readonly loading: boolean;
  readonly error: boolean;
  readonly onSaved: () => Promise<void>;
}) {
  const { t, language } = useLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    setBusy(true);
    setMessage(null);
    try {
      await recordRfqReply(rfq.id, {
        source: text("source"),
        receivedAt: new Date(text("receivedAt")).toISOString(),
        messageId: text("messageId") || null,
        body: String(form.get("body") ?? ""),
      });
      await onSaved();
      setMessage(
        t(
          "회신을 기록했습니다. HTML은 일반 텍스트로만 보관합니다.",
          "Reply recorded. HTML is stored as plain text only.",
        ),
      );
    } catch (caught) {
      setMessage(contactActionError(caught, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reply-panel stack">
      <p className="muted">
        {t(
          "받은 내용을 그대로 남기세요. 금액과 조건은 견적 비교 화면에 기록할 수 있어요.",
          "Keep the received message here. Record prices and terms in quote comparison.",
        )}
      </p>
      {loading ? (
        <p className="muted">{t("회신 불러오는 중", "Loading replies")}</p>
      ) : error ? (
        <p className="banner">
          {t("회신을 불러오지 못했어요.", "Couldn’t load replies.")}
        </p>
      ) : (
        replies.map((reply) => (
          <article className="reply-entry" key={reply.id}>
            <p className="muted">
              {reply.inboxMessageId ? t("업무 메일 회신", "Work email reply") : reply.source} · {contactDate(reply.receivedAt, language)}
              {!reply.inboxMessageId && reply.messageId ? ` · ${reply.messageId}` : ""}
            </p>
            {reply.inboxMessageId && <NavLink className="text-btn" to={`/inbox/${encodeURIComponent(reply.inboxMessageId)}`}>{t("회신 원문 보기", "View original reply")}</NavLink>}
            <p className="source-text">{reply.body}</p>
          </article>
        ))
      )}
      <form className="reply-record stack" onSubmit={submit}>
        <h3>{t("일반 텍스트 회신 기록", "Record plain-text reply")}</h3>
        <div className="contact-form-grid">
          <div className="field">
            <label htmlFor={`reply-source-${rfq.id}`}>
              {t("출처", "Source")}
            </label>
            <input
              id={`reply-source-${rfq.id}`}
              name="source"
              required
              maxLength={10000}
            />
          </div>
          <div className="field">
            <label htmlFor={`reply-time-${rfq.id}`}>
              {t("수신 시점", "Received at")}
            </label>
            <input
              id={`reply-time-${rfq.id}`}
              name="receivedAt"
              type="datetime-local"
              required
            />
          </div>
          <div className="field contact-form-wide">
            <label htmlFor={`reply-id-${rfq.id}`}>
              {t(
                "메시지 ID · 모르면 비움",
                "Message ID · leave blank if unknown",
              )}
            </label>
            <input
              id={`reply-id-${rfq.id}`}
              name="messageId"
              maxLength={1000}
            />
          </div>
          <div className="field contact-form-wide">
            <label htmlFor={`reply-body-${rfq.id}`}>
              {t("회신 본문", "Reply body")}
            </label>
            <textarea
              id={`reply-body-${rfq.id}`}
              name="body"
              rows={7}
              required
              maxLength={100000}
            />
          </div>
        </div>
        {message && (
          <p
            className={
              message.includes("기록") || message.includes("recorded")
                ? "save-notice"
                : "banner"
            }
            role="status"
          >
            {message}
          </p>
        )}
        <button className="btn btn-secondary" disabled={busy}>
          {busy ? t("기록 중", "Recording") : t("회신 기록", "Record reply")}
        </button>
      </form>
    </div>
  );
}
