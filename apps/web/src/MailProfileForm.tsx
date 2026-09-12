import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type {
  MailProfileConfig,
  MailProfileSafeView,
} from "../../../packages/domain/src/mail-profile.ts";
import {
  MailProfileRequestError,
  saveMailProfile,
  type MailProfileSaveInput,
} from "./mail-profile-api.ts";
import {
  MailProfileFields,
  type MailProfileDraft,
} from "./MailProfileFields.tsx";
import { useLocale } from "./ui.tsx";

function profileKey(profile: MailProfileSafeView): string {
  return `${profile.profileId ?? "new"}:${profile.version ?? 0}`;
}

function draftFromProfile(profile: MailProfileSafeView): MailProfileDraft {
  const config = profile.configuredFields;
  return {
    name: config?.name ?? "",
    smtpHost: config?.smtpHost ?? "",
    smtpPort: config?.smtpPort === 587 ? "587" : "465",
    imapHost: config?.imapHost ?? "",
    sender: config?.sender ?? "",
    username: config?.username ?? "",
    sentMailbox: config?.sentMailbox ?? "Sent",
    inboxMailbox: config?.inboxMailbox ?? "INBOX",
    password: "",
  };
}

function saveInput(
  draft: MailProfileDraft,
  expectedVersion: number | undefined,
): MailProfileSaveInput {
  const config: MailProfileConfig = {
    name: draft.name.trim(),
    smtpHost: draft.smtpHost.trim(),
    smtpPort: draft.smtpPort === "587" ? 587 : 465,
    imapHost: draft.imapHost.trim(),
    imapPort: 993,
    sender: draft.sender.trim(),
    username: draft.username.trim(),
    sentMailbox: draft.sentMailbox.trim(),
    inboxMailbox: draft.inboxMailbox.trim(),
  };
  return {
    ...config,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(draft.password ? { password: draft.password } : {}),
  };
}

function saveError(error: unknown, ko: boolean): string {
  if (error instanceof MailProfileRequestError) {
    if (error.status === 409)
      return ko
        ? "현재 설정이 바뀌었어요. 입력한 내용은 그대로입니다. 현재 설정을 다시 불러온 뒤 검토해 주세요."
        : "The current configuration changed. Your entries are still here. Reload the current configuration before reviewing it.";
    if (error.code === "MAIL_HOST_INVALID")
      return ko ? "메일 서버 주소를 확인해 주세요." : "Check the mail server address.";
  }
  return ko
    ? "설정을 저장하지 못했어요. 입력 내용을 확인해 주세요."
    : "Couldn’t save the settings. Check the entries and try again.";
}

export function MailProfileForm({
  profile,
  onSaved,
  onReload,
  onBusyChange,
  acceptedDisableVersion,
}: {
  profile: MailProfileSafeView;
  acceptedDisableVersion: number | null;
  onSaved: (profile: MailProfileSafeView) => Promise<void>;
  onReload: () => Promise<MailProfileSafeView | undefined>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, language } = useLocale();
  const [draft, setDraft] = useState(() => draftFromProfile(profile));
  const [draftKey, setDraftKey] = useState(() => profileKey(profile));
  const [draftVersion, setDraftVersion] = useState(profile.version ?? undefined);
  const [serverChanged, setServerChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function replaceDraft(next: MailProfileSafeView): void {
    setDraft(draftFromProfile(next));
    setDraftKey(profileKey(next));
    setDraftVersion(next.version ?? undefined);
    setServerChanged(false);
  }

  useEffect(() => {
    if (profileKey(profile) === draftKey) return;
    if (!serverChanged && draftVersion !== undefined &&
        profile.status === "disabled" && profile.version === draftVersion + 1 &&
        acceptedDisableVersion === profile.version) {
      setDraftKey(profileKey(profile));
      setDraftVersion(profile.version);
      return;
    }
    setServerChanged(true);
  }, [acceptedDisableVersion, draftKey, draftVersion, profile, serverChanged]);

  async function reload(): Promise<void> {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    try {
      const current = await onReload();
      if (!current) {
        setError(t("현재 설정을 가져오지 못했어요. 입력은 그대로입니다.", "Could not load current settings. Your entries are preserved."));
        return;
      }
      replaceDraft(current);
      setError(null);
      setNotice(null);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveMailProfile(saveInput(draft, draftVersion));
      replaceDraft(saved);
      await onSaved(saved);
      setNotice(
        t(
          "설정을 저장했어요. 사용하려면 아래에서 승인 요청을 만들어 주세요.",
          "Settings saved. Create an approval request below before using this mail profile.",
        ),
      );
    } catch (caught) {
      if (caught instanceof MailProfileRequestError && caught.status === 409) setServerChanged(true);
      setError(saveError(caught, language === "ko"));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => void submit(event)}>
      <header className="stack">
        <h2>{t("업무 메일 설정", "Work email settings")}</h2>
        <p className="muted">
          {t(
            "메일 서비스의 서버·사서함 정보를 입력하세요. 저장한 뒤 사용 승인을 검토합니다.",
            "Enter your mail service’s server and mailbox details, then review use approval after saving.",
          )}
        </p>
      </header>
      {serverChanged && (
        <p className="banner" role="alert">
          {t(
            "다른 변경으로 현재 설정이 바뀌었어요. 입력한 내용은 그대로입니다.",
            "The current configuration changed elsewhere. Your entries are still here.",
          )}{" "}
          <button className="text-btn" type="button" disabled={busy} onClick={() => void reload()}>
            {t("현재 설정 다시 불러오기", "Reload current settings")}
          </button>
        </p>
      )}
      <div className="contact-form-grid"><MailProfileFields draft={draft} onChange={(next) => setDraft(next)} busy={busy} /></div>
      {error && <p className="banner" role="alert">{error}</p>}
      {notice && <p className="save-notice" role="status">{notice}</p>}
      <button className={`btn ${profile.configuredFields ? "btn-secondary" : "btn-primary"}`} disabled={busy}>
        {busy ? t("저장 중", "Saving") : t("업무 메일 설정 저장", "Save work email settings")}
      </button>
    </form>
  );
}
