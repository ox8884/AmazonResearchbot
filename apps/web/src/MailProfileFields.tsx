import { useLocale } from "./ui.tsx";

export type MailProfileDraft = {
  readonly name: string;
  readonly smtpHost: string;
  readonly smtpPort: "465" | "587";
  readonly imapHost: string;
  readonly sender: string;
  readonly username: string;
  readonly sentMailbox: string;
  readonly inboxMailbox: string;
  readonly password: string;
};

export function MailProfileFields({
  draft,
  onChange,
  busy,
}: {
  draft: MailProfileDraft;
  onChange: (draft: MailProfileDraft) => void;
  busy: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className="field">
        <label htmlFor="mail-profile-name">
          {t("표시 이름", "Display name")}
        </label>
        <input
          id="mail-profile-name"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          required
          maxLength={120}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="mail-profile-sender">
          {t("보내는 주소", "Sender address")}
        </label>
        <input
          id="mail-profile-sender"
          type="email"
          value={draft.sender}
          onChange={(event) =>
            onChange({ ...draft, sender: event.target.value })
          }
          required
          maxLength={320}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="mail-profile-username">
          {t("사서함 사용자 이름", "Mailbox username")}
        </label>
        <input
          id="mail-profile-username"
          value={draft.username}
          onChange={(event) =>
            onChange({ ...draft, username: event.target.value })
          }
          required
          maxLength={320}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="mail-profile-password">
          {t("비밀번호", "Password")}
        </label>
        <input
          id="mail-profile-password"
          type="password"
          value={draft.password}
          onChange={(event) =>
            onChange({ ...draft, password: event.target.value })
          }
          autoComplete="new-password"
          maxLength={4096}
          disabled={busy}
        />
        <p className="muted">
          {t(
            "기존 비밀번호가 있으면 빈칸으로 유지할 수 있습니다. 저장 뒤 입력은 비워집니다.",
            "If a password is already saved, leave this blank to keep it. This field clears after saving.",
          )}
        </p>
      </div>
      <div className="field">
        <label htmlFor="mail-profile-smtp-host">
          SMTP {t("서버", "server")}
        </label>
        <input
          id="mail-profile-smtp-host"
          value={draft.smtpHost}
          onChange={(event) =>
            onChange({ ...draft, smtpHost: event.target.value })
          }
          required
          maxLength={253}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="mail-profile-smtp-port">SMTP {t("포트", "port")}</label>
        <select
          id="mail-profile-smtp-port"
          value={draft.smtpPort}
          onChange={(event) => {
            const port = event.target.value;
            if (port === "465" || port === "587")
              onChange({ ...draft, smtpPort: port });
          }}
          disabled={busy}
        >
          <option value="465">465 · TLS</option>
          <option value="587">587 · STARTTLS</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="mail-profile-imap-host">
          IMAP {t("서버", "server")}
        </label>
        <input
          id="mail-profile-imap-host"
          value={draft.imapHost}
          onChange={(event) =>
            onChange({ ...draft, imapHost: event.target.value })
          }
          required
          maxLength={253}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="mail-profile-imap-port">IMAP {t("포트", "port")}</label>
        <input id="mail-profile-imap-port" value="993 · TLS" readOnly />
        <p className="muted">
          {t("IMAP은 993만 사용합니다.", "IMAP uses port 993 only.")}
        </p>
      </div>
      <div className="field">
        <label htmlFor="mail-profile-sent">
          {t("보낸편지함", "Sent mailbox")}
        </label>
        <input
          id="mail-profile-sent"
          value={draft.sentMailbox}
          onChange={(event) =>
            onChange({ ...draft, sentMailbox: event.target.value })
          }
          required
          maxLength={255}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="mail-profile-inbox">
          {t("받은편지함", "Inbox mailbox")}
        </label>
        <input
          id="mail-profile-inbox"
          value={draft.inboxMailbox}
          onChange={(event) =>
            onChange({ ...draft, inboxMailbox: event.target.value })
          }
          required
          maxLength={255}
          disabled={busy}
        />
      </div>
    </>
  );
}
