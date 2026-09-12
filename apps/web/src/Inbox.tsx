import { useInfiniteQuery } from "@tanstack/react-query";
import { NavLink, useSearchParams } from "react-router";
import type { InboxMessageSummary } from "../../../packages/domain/src/inbox.ts";
import { getInboxWorkspace, type InboxFilter } from "./inbox-api.ts";
import {
  InboxClassificationChip,
  InboxProfileSummary,
  inboxDate,
  inboxSender,
  inboxSubject,
} from "./InboxPresentation.tsx";
import { Empty, Icon, LoadError, Loading, PageHeader, useLocale } from "./ui.tsx";
import "../../../packages/ui/src/inbox.css";

type InboxPageParam = { readonly cursor: string | null };

const initialPageParam: InboxPageParam = { cursor: null };

function readFilter(value: string | null): InboxFilter {
  return value === "unclassified" ? "unclassified" : "all";
}

function MessageCard({
  message,
  language,
  t,
}: {
  readonly message: InboxMessageSummary;
  readonly language: string;
  readonly t: (ko: string, en: string) => string;
}) {
  return (
    <article className="inbox-message card">
      <div className="inbox-message-heading">
        <div className="stack">
          <p className="inbox-sender">{inboxSender(message.from, t)}</p>
          <h2>{inboxSubject(message.subject, t)}</h2>
        </div>
        <InboxClassificationChip classification={message.classification} t={t} />
      </div>
      <dl className="inbox-message-meta">
        <div>
          <dt>{t("수신", "Received")}</dt>
          <dd>{inboxDate(message.receivedAt, language, t)}</dd>
        </div>
        <div>
          <dt>{t("수집", "Collected")}</dt>
          <dd>{inboxDate(message.collectedAt, language, t)}</dd>
        </div>
        <div>
          <dt>{t("후보", "Candidate")}</dt>
          <dd>{message.candidate?.keyword ?? t("미연결", "Not linked")}</dd>
        </div>
      </dl>
      <NavLink className="text-btn" to={`/inbox/${encodeURIComponent(message.id)}`}>
        {t("회신 상세 보기", "View reply details")}
        <Icon name="arrow" />
      </NavLink>
    </article>
  );
}

export function Inbox() {
  const { language, t } = useLocale();
  const [parameters, setParameters] = useSearchParams();
  const filter = readFilter(parameters.get("filter"));
  const inbox = useInfiniteQuery({
    queryKey: ["inbox", filter] as const,
    initialPageParam,
    queryFn: ({ pageParam }: { readonly pageParam: InboxPageParam }) =>
      getInboxWorkspace(filter, pageParam.cursor),
    getNextPageParam: (page) =>
      page.nextCursor === null ? undefined : { cursor: page.nextCursor },
    refetchInterval: 10000,
  });
  const pages = inbox.data?.pages ?? [];
  const messages = pages.flatMap((page) => page.messages);
  const workspace = pages[0];

  function chooseFilter(next: InboxFilter): void {
    const updated = new URLSearchParams(parameters);
    updated.set("filter", next);
    setParameters(updated);
  }

  if (inbox.isPending) return <Loading />;
  if (!workspace) return <LoadError retry={() => void inbox.refetch()} />;

  return (
    <div className="inbox-page stack">
      <PageHeader
        eyebrow={t("업무 메일", "Work email")}
        title={t("견적 회신", "Quote replies")}
        description={t(
          "받은 견적 회신을 확인하고, 필요한 경우 견적 요청에 직접 연결하세요.",
          "Review received supplier replies and link one to a quote request when needed.",
        )}
      />
      <InboxProfileSummary workspace={workspace} language={language} t={t} />
      {(workspace.profileStatus !== "active" || !workspace.collectionEnabled) && (
        <div className="inbox-settings-links">
          <NavLink className="btn btn-secondary" to="/settings/mail">
            {t("업무 메일 설정", "Work email settings")}
          </NavLink>
          <NavLink className="text-btn" to="/settings">
            {t("설정 보기", "View settings")}
            <Icon name="arrow" />
          </NavLink>
        </div>
      )}
      <div className="inbox-filter" role="group" aria-label={t("회신 필터", "Reply filter")}>
        <button
          className={`btn btn-secondary inbox-filter-button ${filter === "all" ? "is-selected" : ""}`}
          aria-pressed={filter === "all"}
          onClick={() => chooseFilter("all")}
        >
          {t("전체", "All")}
        </button>
        <button
          className={`btn btn-secondary inbox-filter-button ${filter === "unclassified" ? "is-selected" : ""}`}
          aria-pressed={filter === "unclassified"}
          onClick={() => chooseFilter("unclassified")}
        >
          {t("분류 필요", "Needs review")}
        </button>
      </div>
      {inbox.isError && (
        <div className="banner" role="alert">
          <p>{t("새 회신을 불러오지 못했어요. 이미 열린 목록은 그대로입니다.", "Couldn’t load more replies. The current list is still here.")}</p>
          <button className="text-btn" onClick={() => void inbox.refetch()}>
            {t("다시 시도", "Try again")}
          </button>
        </div>
      )}
      {messages.length ? (
        <section className="inbox-list" aria-label={t("견적 회신 목록", "Quote reply list")}>
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} language={language} t={t} />
          ))}
        </section>
      ) : (
        <Empty
          icon="quote"
          title={t("표시할 견적 회신이 없어요", "No quote replies to show")}
          description={t(
            "새 회신이 수집되면 이 목록에 표시됩니다.",
            "Newly collected replies will appear here.",
          )}
        />
      )}
      {inbox.hasNextPage && (
        <button
          className="btn btn-secondary inbox-load-more"
          disabled={inbox.isFetchingNextPage}
          onClick={() => void inbox.fetchNextPage()}
        >
          {inbox.isFetchingNextPage
            ? t("다음 회신 불러오는 중", "Loading more replies")
            : t("회신 더 보기", "Load more replies")}
        </button>
      )}
    </div>
  );
}
