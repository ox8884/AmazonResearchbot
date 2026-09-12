import { useMutation } from "@tanstack/react-query";
import type {
  MailProfileActivation,
  MailProfileConfig,
  MailProfileSafeView,
} from "../../../packages/domain/src/mail-profile.ts";
import {
  decideMailProfileApproval,
  disableMailProfile,
  requestMailProfileActivation,
} from "./mail-profile-api.ts";
import { useLocale } from "./ui.tsx";

type MailProfileApproval = {
  readonly id: string;
  readonly payload: MailProfileActivation;
};

function secretLabel(
  last4: string | null,
  t: (ko: string, en: string) => string,
): string {
  return last4
    ? `${t("설정됨", "Configured")} · •••${last4}`
    : t("설정 안 됨", "Not configured");
}

function ReviewDetails({
  config,
  profile,
}: {
  config: MailProfileConfig;
  profile: MailProfileSafeView;
}) {
  const { t } = useLocale();
  return (
    <dl className="settings-values">
      <div>
        <dt>{t("표시 이름", "Display name")}</dt>
        <dd>{config.name}</dd>
      </div>
      <div>
        <dt>{t("설정", "Configuration")}</dt>
        <dd>v{profile.version}</dd>
      </div>
      <div>
        <dt>{t("보내는 주소", "Sender")}</dt>
        <dd>{config.sender}</dd>
      </div>
      <div>
        <dt>SMTP {t("서버", "server")}</dt>
        <dd>
          {config.smtpHost}:{config.smtpPort}
        </dd>
      </div>
      <div>
        <dt>IMAP {t("서버", "server")}</dt>
        <dd>
          {config.imapHost}:{config.imapPort}
        </dd>
      </div>
      <div>
        <dt>{t("사서함 사용자 이름", "Mailbox username")}</dt>
        <dd>{config.username}</dd>
      </div>
      <div>
        <dt>{t("보낸편지함 · 받은편지함", "Sent · inbox")}</dt>
        <dd>
          {config.sentMailbox} · {config.inboxMailbox}
        </dd>
      </div>
      <div>
        <dt>{t("비밀번호", "Password")}</dt>
        <dd>{secretLabel(profile.last4, t)}</dd>
      </div>
    </dl>
  );
}

function ActionError() {
  const { t } = useLocale();
  return (
    <p className="banner" role="alert">
      {t(
        "현재 설정이 바뀌었을 수 있어요. 현재 설정을 다시 불러온 뒤 확인해 주세요.",
        "The current configuration may have changed. Reload it, then review again.",
      )}
    </p>
  );
}

function Panel({ title, description }: { title: string; description: string }) {
  return (
    <section className="card stack">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
    </section>
  );
}

export function MailProfileActionPanel({
  profile,
  approvals,
  approvalsUnavailable,
  reviewBlocked,
  onProfileChanged,
}: {
  profile: MailProfileSafeView;
  approvals: readonly MailProfileApproval[];
  approvalsUnavailable: boolean;
  reviewBlocked: boolean;
  onProfileChanged: (profile?: MailProfileSafeView) => Promise<void>;
}) {
  const { t } = useLocale();
  const requestApproval = useMutation({
    mutationFn: (version: number) => requestMailProfileActivation(version),
    onSuccess: onProfileChanged,
  });
  const approve = useMutation({
    mutationFn: (approvalId: string) =>
      decideMailProfileApproval(approvalId, "approve"),
    onSuccess: async () => {
      await onProfileChanged();
    },
  });
  const reject = useMutation({
    mutationFn: (id: string) => decideMailProfileApproval(id, "reject"),
    onSuccess: async () => {
      await onProfileChanged();
    },
  });
  const disable = useMutation({
    mutationFn: (version: number) => disableMailProfile(version),
    onSuccess: onProfileChanged,
  });
  const busy =
    requestApproval.isPending ||
    approve.isPending ||
    reject.isPending ||
    disable.isPending;
  const pending = approvals.find(
    (approval) =>
      approval.payload.profileId === profile.profileId &&
      approval.payload.version === profile.version,
  );
  const config = pending?.payload.config ?? profile.configuredFields;
  if (profile.status === "active")
    return (
      <section className="card stack">
        <h2>{t("업무 메일 사용 승인됨", "Work email use approved")}</h2>
        <p className="muted">
          {t(
            "연결 상태는 미확인입니다. 발송 결과는 각 견적 요청에서 확인할 수 있습니다.",
            "Connection status is unconfirmed. Delivery results are shown with each quote request.",
          )}
        </p>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={busy || reviewBlocked || profile.version === null}
          onClick={() => {
            if (profile.version !== null) disable.mutate(profile.version);
          }}
        >
          {disable.isPending
            ? t("사용 중지 중", "Disabling")
            : t("업무 메일 사용 중지", "Disable work email use")}
        </button>
        {disable.isError && <ActionError />}
      </section>
    );
  if (!profile.configuredFields)
    return (
      <Panel
        title={t("업무 메일을 설정해 주세요", "Set up work email")}
        description={t(
          "서버와 사서함 정보를 저장한 뒤 사용 승인을 요청할 수 있습니다.",
          "Save the server and mailbox details before requesting use approval.",
        )}
      />
    );
  if (!profile.secretConfigured)
    return (
      <Panel
        title={t("비밀번호를 저장해 주세요", "Save a password")}
        description={t(
          "비밀번호 없이는 사용 승인 요청을 만들 수 없습니다.",
          "A password is required before a use approval request can be created.",
        )}
      />
    );
  if (!config) return null;
  if (pending)
    return (
      <section
        className="card stack mail-profile-review"
        aria-labelledby="mail-profile-review"
      >
        <h2 id="mail-profile-review">
          {t("사용 승인 검토", "Review use approval")}
        </h2>
        <p className="muted">
          {t(
            "아래 저장된 설정을 검토하세요. 승인한 견적 요청의 발송, 보낸 메일 확인, 받은 회신 수집에 사용합니다.",
            "Review the saved settings below. This mailbox is used for approved quote requests, checking sent messages, and collecting incoming replies.",
          )}
        </p>
        <ReviewDetails config={config} profile={profile} />
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || reviewBlocked || approvalsUnavailable}
          onClick={() => approve.mutate(pending.id)}
        >
          {approve.isPending
            ? t("승인 중", "Approving")
            : t("업무 메일 사용 승인", "Approve work email use")}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={busy || reviewBlocked}
          onClick={() => reject.mutate(pending.id)}
        >
          {t("이 요청 거절", "Reject this request")}
        </button>
        {(approve.isError || reject.isError) && <ActionError />}
      </section>
    );
  return (
    <section className="card stack">
      <h2>
        {profile.status === "disabled"
          ? t("업무 메일 사용 중지됨", "Work email use disabled")
          : t("업무 메일 사용 승인 필요", "Work email use needs approval")}
      </h2>
      <p className="muted">
        {approvalsUnavailable
          ? t(
              "승인 요청 상태를 확인하지 못했어요. 현재 설정으로 다시 요청할 수 있습니다.",
              "Couldn’t check approval requests. You can request review for the current settings again.",
            )
          : t(
              "저장된 설정은 아직 사용되지 않습니다. 검토 요청을 만든 뒤 한 번 승인해 주세요.",
              "Saved settings are not in use yet. Create a review request, then approve it once.",
            )}
      </p>
      <button
        className="btn btn-primary"
        type="button"
        disabled={busy || reviewBlocked || profile.version === null}
        onClick={() => {
          if (profile.version !== null) requestApproval.mutate(profile.version);
        }}
      >
        {requestApproval.isPending
          ? t("요청 중", "Requesting")
          : t("업무 메일 사용 승인 요청", "Request work email use approval")}
      </button>
      {requestApproval.isError && <ActionError />}
    </section>
  );
}
