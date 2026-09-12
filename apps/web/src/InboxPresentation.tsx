import type {
  InboxAttachmentView,
  InboxClassification,
  InboxMessageSummary,
  InboxWorkspace,
} from "../../../packages/domain/src/inbox.ts";
import { Icon, type IconName } from "./ui.tsx";

type Translate = (ko: string, en: string) => string;

function unreachable(value: never): never {
  throw new Error(`Unexpected inbox state: ${value}`);
}

export function inboxDate(
  value: string | null,
  language: string,
  t: Translate,
): string {
  if (!value) return t("미확인", "Unknown");
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return t("미확인", "Unknown");
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function inboxSubject(subject: string | null, t: Translate): string {
  return subject || t("제목 미확인", "Subject unknown");
}

export function inboxSender(
  senders: readonly string[],
  t: Translate,
): string {
  return senders.length
    ? senders.join(", ")
    : t("보낸 사람 미확인", "Sender unknown");
}

function classificationView(
  classification: InboxClassification,
  t: Translate,
): { readonly className: string; readonly icon: IconName; readonly label: string } {
  switch (classification) {
    case "linked":
      return { className: "chip-ok", icon: "check", label: t("연결됨", "Linked") };
    case "unclassified":
      return { className: "chip-warn", icon: "warning", label: t("분류 필요", "Needs review") };
    case "duplicate":
      return { className: "chip-unknown", icon: "unknown", label: t("중복 회신", "Duplicate reply") };
    case "conflict":
      return { className: "chip-warn", icon: "warning", label: t("내용 검토 필요", "Content needs review") };
    default:
      return unreachable(classification);
  }
}

export function InboxClassificationChip({
  classification,
  t,
}: {
  readonly classification: InboxClassification;
  readonly t: Translate;
}) {
  const view = classificationView(classification, t);
  return (
    <span className={`chip ${view.className}`}>
      <Icon name={view.icon} />
      {view.label}
    </span>
  );
}

function profileStatus(
  status: InboxWorkspace["profileStatus"],
  t: Translate,
): { readonly className: string; readonly label: string } {
  switch (status) {
    case "active":
      return { className: "chip-ok", label: t("업무 메일 사용 승인됨", "Work email approved") };
    case "disabled":
      return { className: "chip-warn", label: t("업무 메일 사용 중지됨", "Work email disabled") };
    case "pending_approval":
      return { className: "chip-warn", label: t("업무 메일 승인 필요", "Work email approval needed") };
    case "unconfigured":
      return { className: "chip-unknown", label: t("업무 메일 설정 전", "Work email not configured") };
    default:
      return unreachable(status);
  }
}

export function InboxProfileSummary({
  workspace,
  language,
  t,
}: {
  readonly workspace: InboxWorkspace;
  readonly language: string;
  readonly t: Translate;
}) {
  const status = profileStatus(workspace.profileStatus, t);
  return (
    <section className="inbox-profile card" aria-label={t("메일 수집 상태", "Mail collection status")}>
      <div className="inbox-profile-heading">
        <div>
          <h2>{t("메일 수집 상태", "Mail collection status")}</h2>
          <p className="muted">
            {workspace.collectionEnabled
              ? t("수집이 켜져 있어요", "Collection is enabled")
              : t("수집이 꺼져 있어요", "Collection is disabled")}
          </p>
        </div>
        <span className={`chip ${status.className}`}>{status.label}</span>
      </div>
      <dl className="inbox-status-values">
        <div>
          <dt>{t("마지막 확인", "Last checked")}</dt>
          <dd>{inboxDate(workspace.lastCheckedAt, language, t)}</dd>
        </div>
        <div>
          <dt>{t("최근 오류", "Recent issue")}</dt>
          <dd>
            {workspace.lastError
              ? `${t("최근 확인에서 문제가 있었어요", "The most recent check had an issue")} · ${inboxDate(workspace.lastError.at, language, t)}`
              : t("없음", "None")}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function inboxBodyState(
  state: InboxAttachmentView["state"] | "missing",
  t: Translate,
): string {
  switch (state) {
    case "text":
      return t("텍스트 확인됨", "Text available");
    case "unsupported":
      return t("표시할 수 없는 형식", "Unsupported format");
    case "too_large":
      return t("텍스트가 너무 큼", "Text is too large");
    case "unreadable":
      return t("텍스트를 읽을 수 없음", "Text is unreadable");
    case "missing":
      return t("본문 미확인", "Body unavailable");
    default:
      return unreachable(state);
  }
}

export function inboxAttachmentSize(
  bytes: number | null,
  t: Translate,
): string {
  if (bytes === null) return t("미확인", "Unknown");
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
