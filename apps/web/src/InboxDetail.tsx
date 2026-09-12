import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { NavLink, useParams } from "react-router";
import type { InboxLinkOption, InboxMessageDetail } from "../../../packages/domain/src/inbox.ts";
import {
  getInboxMessage,
  InboxRequestError,
  linkInboxMessage,
  type InboxLinkResult,
} from "./inbox-api.ts";
import {
  InboxClassificationChip,
  inboxAttachmentSize,
  inboxBodyState,
  inboxDate,
  inboxSender,
  inboxSubject,
} from "./InboxPresentation.tsx";
import { Empty, Icon, LoadError, Loading, PageHeader, useLocale } from "./ui.tsx";
import "../../../packages/ui/src/inbox.css";

function linkError(error: unknown, t: (ko: string, en: string) => string): string {
  if (error instanceof InboxRequestError) {
    if (error.code === "ALREADY_LINKED")
      return t("다른 견적 요청에 이미 연결되어 있습니다. 현재 연결을 확인해 주세요.", "This reply is already linked to another quote request. Check the current link.");
    if (error.code === "REPLY_CONFLICT")
      return t("지금 연결할 수 없습니다. 원문과 견적 요청의 현재 상태를 확인해 주세요.", "This reply cannot be linked now. Check the original and the current quote request.");
    if (error.code === "NOT_FOUND")
      return t("선택한 견적 요청을 찾을 수 없어요. 목록을 다시 확인해 주세요.", "The selected quote request was not found. Check the list again.");
    if (error.code === "INVALID")
      return t("이 회신은 지금 연결할 수 없어요. 선택한 견적 요청을 다시 확인해 주세요.", "This reply cannot be linked now. Check the selected quote request.");
  }
  return t("연결을 저장하지 못했어요. 선택한 내용은 그대로입니다.", "Couldn’t save the link. Your selection is still here.");
}

function LinkForm({
  detail,
  onLinked,
  refreshing,
  onReload,
}: {
  readonly detail: InboxMessageDetail;
  readonly onLinked: (result: InboxLinkResult) => void;
  readonly refreshing: boolean;
  readonly onReload: () => void;
}) {
  const { t } = useLocale();
  const [rfqId, setRfqId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const option = detail.linkOptions.find((item) => item.rfqId === rfqId);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!option || busy || refreshing) return;
    setBusy(true);
    setError(null);
    try {
      const result = await linkInboxMessage(detail.message.id, option.rfqId);
      onLinked(result);
    } catch (caught) {
      setError(linkError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inbox-link-form card" onSubmit={(event) => void submit(event)}>
      <div className="stack">
        <h2>{t("견적 요청에 연결", "Link to quote request")}</h2>
        <p className="muted">
          {t("연결할 견적 요청을 직접 고른 뒤 내용을 확인하세요. 자동 연결하지 않습니다.", "Choose a quote request yourself, then review the details. Nothing is linked automatically.")}
        </p>
      </div>
      {detail.linkOptions.length ? (
        <>
          <div className="field">
            <label htmlFor="inbox-rfq-link">{t("견적 요청", "Quote request")}</label>
            <select
              id="inbox-rfq-link"
              value={rfqId}
              disabled={busy || refreshing}
              onChange={(event) => setRfqId(event.target.value)}
            >
              <option value="">{t("견적 요청을 선택하세요", "Select a quote request")}</option>
              {detail.linkOptions.map((item) => (
                <option key={item.rfqId} value={item.rfqId}>
                  {item.keyword} · {item.subject}
                </option>
              ))}
            </select>
          </div>
          {option && <LinkPreview option={option} />}
          {error && <div className="banner" role="alert"><p>{error}</p><button className="text-btn" type="button" disabled={busy || refreshing} onClick={onReload}>{t("현재 연결 확인", "Check current link")}</button></div>}
          <button className="btn btn-primary" disabled={!option || busy || refreshing}>
            {busy ? t("연결 중", "Linking") : t("이 견적 요청에 연결", "Link to this quote request")}
          </button>
        </>
      ) : (
        <p className="muted">{t("지금 연결할 수 있는 견적 요청이 없어요.", "There are no quote requests available to link right now.")}</p>
      )}
    </form>
  );
}

function LinkPreview({ option }: { readonly option: InboxLinkOption }) {
  const { t } = useLocale();
  return (
    <dl className="inbox-link-preview">
      <div><dt>{t("후보", "Candidate")}</dt><dd>{option.keyword}</dd></div>
      <div><dt>{t("받는 사람", "Recipient")}</dt><dd>{option.recipient}</dd></div>
      <div><dt>{t("제목", "Subject")}</dt><dd>{option.subject}</dd></div>
      <div><dt>{t("수량", "Quantity")}</dt><dd>{option.quantity}</dd></div>
    </dl>
  );
}

function Attachments({ detail }: { readonly detail: InboxMessageDetail }) {
  const { t } = useLocale();
  return (
    <section className="inbox-detail-section stack">
      <div className="section-label"><h2>{t("첨부 파일", "Attachments")}</h2></div>
      {detail.attachments.length ? (
        <ul className="inbox-attachments">
          {detail.attachments.map((attachment) => (
            <li key={attachment.id}>
              <div className="inbox-attachment-meta">
                <strong>{attachment.filename ?? t("파일 이름 미확인", "Filename unknown")}</strong>
                <span className="muted">{attachment.mediaType} · {inboxAttachmentSize(attachment.byteSize, t)}</span>
                <span className="chip chip-unknown">{inboxBodyState(attachment.state, t)}</span>
              </div>
              {attachment.text && <pre className="inbox-text">{attachment.text}</pre>}
            </li>
          ))}
        </ul>
      ) : <p className="muted">{t("첨부 파일이 없어요.", "There are no attachments.")}</p>}
    </section>
  );
}

function LinkedActions({ detail }: { readonly detail: InboxMessageDetail }) {
  const { t } = useLocale();
  const { message } = detail;
  if (!message.candidate || !message.specId) return null;
  const search = new URLSearchParams({
    candidate: message.candidate.id,
    spec: message.specId,
    reply: message.id,
  });
  return (
    <section className="inbox-linked card">
      <div className="stack">
        <h2>{t("연결된 견적 요청", "Linked quote request")}</h2>
        <NavLink className="keyword-link" to={`/candidates/${encodeURIComponent(message.candidate.id)}`}>
          {message.candidate.keyword}
          <Icon name="arrow" />
        </NavLink>
      </div>
      <NavLink className="btn btn-primary" to={`/sourcing?${search.toString()}`}>
        {t("견적 기록하기", "Record quote")}
        <Icon name="arrow" />
      </NavLink>
    </section>
  );
}

function ManualQuoteAction({ detail }: { readonly detail: InboxMessageDetail }) {
  const { t } = useLocale();
  const { message } = detail;
  const search = new URLSearchParams({ reply: message.id });
  if (message.candidate) search.set("candidate", message.candidate.id);
  if (message.specId) search.set("spec", message.specId);
  return (
    <NavLink className="btn btn-secondary" to={`/sourcing?${search.toString()}`}>
      {t("견적 직접 기록하기", "Record quote manually")}
      <Icon name="arrow" />
    </NavLink>
  );
}

export function InboxDetail() {
  const { id } = useParams();
  const { language, t } = useLocale();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["inbox-message", id],
    queryFn: () => getInboxMessage(id ?? ""),
    enabled: Boolean(id),
  });
  if (!id) return <Empty title={t("회신을 찾을 수 없어요", "Reply not found")} description={t("견적 회신 목록에서 다시 선택해 주세요.", "Select a reply from the quote reply list.")} to="/inbox" action={t("견적 회신 보기", "View quote replies")} />;
  if (!detail.data) return detail.isPending ? <Loading /> : <LoadError retry={() => void detail.refetch()} />;

  const message = detail.data.message;
  const linkable = message.classification === "unclassified" && message.bodyState === "text" && Boolean(message.body?.trim()) && Boolean(message.receivedAt);

  function applyLinkedMessage(result: InboxLinkResult): void {
    client.setQueryData<InboxMessageDetail>(
      ["inbox-message", result.message.id],
      (current) =>
        current
          ? { ...current, message: { ...current.message, ...result.message } }
          : current,
    );
    void client.invalidateQueries({ queryKey: ["inbox"] });
    void detail.refetch();
  }

  return (
    <div className="inbox-detail stack">
      <NavLink className="back-link" to="/inbox">{t("견적 회신으로", "Back to quote replies")}</NavLink>
      <PageHeader eyebrow={t("받은 견적 회신", "Received quote reply")} title={inboxSubject(message.subject, t)} description={inboxSender(message.from, t)} />
      {detail.isError && <p className="banner" role="alert">{t("최신 회신 정보를 불러오지 못했어요. 현재 열린 내용은 그대로입니다.", "Couldn’t refresh the latest reply. The open details are still here.")} <button className="text-btn" onClick={() => void detail.refetch()}>{t("다시 시도", "Try again")}</button></p>}
      <section className="inbox-overview card">
        <InboxClassificationChip classification={message.classification} t={t} />
        <dl className="inbox-message-meta">
          <div><dt>{t("수신", "Received")}</dt><dd>{inboxDate(message.receivedAt, language, t)}</dd></div>
          <div><dt>{t("수집", "Collected")}</dt><dd>{inboxDate(message.collectedAt, language, t)}</dd></div>
          <div><dt>{t("후보", "Candidate")}</dt><dd>{message.candidate?.keyword ?? t("미연결", "Not linked")}</dd></div>
        </dl>
      </section>
      <section className="inbox-detail-section stack">
        <div className="section-label"><h2>{t("회신 본문", "Reply text")}</h2><span className="chip chip-unknown">{inboxBodyState(message.bodyState, t)}</span></div>
        {message.bodyState === "text" && message.body ? <pre className="inbox-text">{message.body}</pre> : <p className="muted">{inboxBodyState(message.bodyState, t)}</p>}
      </section>
      <Attachments detail={detail.data} />
      {message.classification === "linked" ? <LinkedActions detail={detail.data} /> : null}
      {linkable ? <LinkForm key={message.id} detail={detail.data} onLinked={applyLinkedMessage} refreshing={detail.isFetching} onReload={() => void detail.refetch()} /> : null}
      {message.classification === "unclassified" && !linkable && <section className="inbox-manual-record banner" role="status"><p>{t("원문을 확인한 뒤 견적을 직접 기록해 주세요.", "Check the original reply, then record the quote manually.")}</p><ManualQuoteAction detail={detail.data} /></section>}
      {message.classification === "conflict" && <section className="inbox-conflict banner" role="status"><p>{t("기존에 연결된 원문과 내용이 달라요. 이 화면에서는 변경할 수 없으니 견적을 직접 기록해 주세요.", "The existing linked original differs. It is view-only here, so record the quote manually.")}</p><ManualQuoteAction detail={detail.data} /></section>}
      {message.classification === "duplicate" && <p className="muted">{t("중복 회신입니다. 읽기 전용으로 표시합니다.", "This is a duplicate reply and is shown read-only.")}</p>}
    </div>
  );
}
