import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { changePassword, SecurityRequestError } from "./security-api.ts";
import { useLocale } from "./ui.tsx";

export function PasswordChangePanel() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmation) {
      setNotice(t("새 비밀번호가 서로 달라요.", "The new passwords do not match."));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["login-sessions"] }),
        qc.invalidateQueries({ queryKey: ["trusted-devices"] }),
      ]);
      setNotice(
        t(
          "비밀번호를 변경했고 다른 기기의 로그인과 기기 기억도 종료했어요.",
          "Password changed. Other sign-ins and remembered devices were ended.",
        ),
      );
    } catch (error) {
      setNotice(
        error instanceof SecurityRequestError && error.status === 423
          ? t(
              "실패한 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.",
              "Too many failed attempts. Try again in 15 minutes.",
            )
          : error instanceof SecurityRequestError && error.status === 400
            ? t(
                "현재 비밀번호를 확인하거나 새 비밀번호 조건을 확인해 주세요.",
                "Check the current password and new password requirements.",
              )
            : t(
                "비밀번호 변경 결과를 확인하지 못했어요. 다시 시도해 주세요.",
                "Could not confirm the password change. Please try again.",
              ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section">
      <h2>{t("비밀번호 변경", "Change password")}</h2>
      <p className="muted">
        {t(
          "현재 비밀번호를 확인한 뒤 새 비밀번호를 저장합니다.",
          "Confirm your current password, then save a new one.",
        )}
      </p>
      {notice && (
        <p className="banner" role="status">
          {notice}
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="current-password">
            {t("현재 비밀번호", "Current password")}
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">{t("새 비밀번호", "New password")}</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">
            {t("새 비밀번호 확인", "Confirm new password")}
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        <p className="banner">
          {t(
            "변경하면 보안을 위해 다른 기기의 로그인과 기기 기억이 모두 종료됩니다.",
            "For security, changing the password ends all other sign-ins and remembered devices.",
          )}
        </p>
        <div className="btn-row">
          <button className="btn btn-secondary" disabled={busy || !currentPassword || !newPassword || !confirmation}>
            {busy ? t("변경 중", "Changing") : t("비밀번호 변경", "Change password")}
          </button>
        </div>
      </form>
    </section>
  );
}
