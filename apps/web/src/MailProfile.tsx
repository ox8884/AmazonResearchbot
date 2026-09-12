import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router";
import type { MailProfileSafeView } from "../../../packages/domain/src/mail-profile.ts";
import { getMailProfile, pendingMailProfileApprovals } from "./mail-profile-api.ts";
import { MailProfileForm } from "./MailProfileForm.tsx";
import { MailProfileActionPanel } from "./MailProfileReview.tsx";
import { LoadError, Loading, PageHeader, useLocale } from "./ui.tsx";

function statusView(profile: MailProfileSafeView, t: (ko: string, en: string) => string) {
  switch (profile.status) {
    case "active": return { label: t("사용 승인됨", "Use approved"), className: "chip-ok" };
    case "disabled": return { label: t("사용 중지됨", "Use disabled"), className: "chip-warn" };
    case "pending_approval": return profile.secretConfigured
      ? { label: t("사용 승인 필요", "Use approval needed"), className: "chip-warn" }
      : { label: t("비밀번호 필요", "Password needed"), className: "chip-unknown" };
    case "unconfigured": return { label: t("설정 전", "Not configured"), className: "chip-unknown" };
  }
}

export function MailProfile() {
  const { t } = useLocale();
  const client = useQueryClient();
  const [formBusy, setFormBusy] = useState(false);
  const [acceptedDisableVersion, setAcceptedDisableVersion] = useState<number | null>(null);
  const profile = useQuery({ queryKey: ["mail-profile"], queryFn: getMailProfile });
  const approvals = useQuery({ queryKey: ["mail-profile-approvals"], queryFn: pendingMailProfileApprovals });
  async function refresh(next?: MailProfileSafeView): Promise<void> {
    if (next?.status === "disabled") setAcceptedDisableVersion(next.version);
    if (next) client.setQueryData(["mail-profile"], next);
    await Promise.all([profile.refetch(), approvals.refetch()]);
  }
  if (profile.isPending) return <Loading />;
  if (!profile.data) return <LoadError retry={() => void profile.refetch()} />;
  return (
    <>
      <PageHeader title={t("업무 메일", "Work email")} description={t("견적 요청에 사용할 업무 메일 계정을 등록하고 관리합니다.", "Register and manage the work mailbox used for quote requests.")}>
        <div className="btn-row"><NavLink className="text-btn" to="/inbox">{t("견적 회신 보기", "View quote replies")}</NavLink><NavLink className="text-btn" to="/settings">{t("설정으로", "Back to settings")}</NavLink></div>
      </PageHeader>
      {profile.isError && <p className="banner" role="alert">{t("연결을 다시 확인해 주세요. 입력 중인 내용은 유지됩니다.", "Check the connection again. Your entries are preserved.")}</p>}
      <MailProfileForm acceptedDisableVersion={acceptedDisableVersion} onBusyChange={setFormBusy} profile={profile.data} onSaved={refresh} onReload={async () => { const result = await profile.refetch(); return result.isError ? undefined : result.data; }} />
      {profile.data.status === "active" && profile.data.connectionStatus === "unverified" && <p className="banner" role="status">{t("메일 서버 연결 미확인 · 사용 승인과 연결 확인은 별도입니다.", "Mail server connection unverified · use approval and connection verification are separate.")}</p>}
      <MailProfileActionPanel profile={profile.data} approvals={approvals.data ?? []} approvalsUnavailable={approvals.isError || profile.isError} reviewBlocked={formBusy} onProfileChanged={refresh} />
    </>
  );
}

export function WorkMailSettingsRow() {
  const { t } = useLocale();
  const profile = useQuery({ queryKey: ["mail-profile"], queryFn: getMailProfile });
  if (profile.isPending) return <div className="connection-row"><div><strong>{t("업무 메일", "Work email")}</strong><p className="muted">{t("상태 확인 중", "Checking status")}</p></div></div>;
  if (profile.isError || !profile.data) return <NavLink className="connection-row" to="/settings/mail"><div><strong>{t("업무 메일", "Work email")}</strong><p className="muted">{t("상태를 확인해 주세요", "Check status")}</p></div><span className="chip chip-unknown">{t("미확인", "Unknown")}</span></NavLink>;
  const status = statusView(profile.data, t);
  const connection = profile.data.connectionStatus === "unverified" ? t("메일 서버 연결 미확인", "Mail server connection unverified") : t("서버 정보 없음", "No server details");
  return <NavLink className="connection-row" to="/settings/mail"><div><strong>{t("업무 메일", "Work email")}</strong><p className="muted">{connection}</p></div><span className={`chip ${status.className}`}>{status.label}</span></NavLink>;
}
