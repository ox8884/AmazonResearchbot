import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { enableTotp, verifyTotp } from "./api.ts";
import { AuthFrame } from "./AuthFrame.tsx";
import { useLocale } from "./ui.tsx";

export function Setup2fa() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || (uri && !savedCodes)) return;
    setBusy(true);
    setError(null);
    try {
      if (!uri) {
        const result = await enableTotp(password);
        if (
          !result.totpURI ||
          !Array.isArray(result.backupCodes) ||
          !result.backupCodes.length
        )
          throw new Error("enable");
        setBackupCodes(result.backupCodes);
        setSavedCodes(false);
        setUri(result.totpURI);
        setPassword("");
      } else {
        const result = await verifyTotp(code);
        if (result.code || result.message) throw new Error("verify");
        await qc.invalidateQueries({ queryKey: ["session"] });
      }
    } catch {
      setError(
        t(
          "인증 정보를 확인하고 다시 시도해 주세요.",
          "Check your credentials and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame second={Boolean(uri)}>
      <header className="stack">
        <h2>{t("2단계 인증 연결", "Set up two-step verification")}</h2>
        <p className="muted">
          {t(
            "개인 작업 공간을 보호하도록 인증 앱을 연결하세요.",
            "Connect your authenticator to protect this workspace.",
          )}
        </p>
      </header>
      <form className="login-form" onSubmit={submit}>
        {!uri ? (
          <div className="field">
            <label htmlFor="setup-password">{t("비밀번호", "Password")}</label>
            <input
              id="setup-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        ) : (
          <>
            <p>
              {t(
                "인증 앱에서 설정 키를 직접 입력하세요.",
                "Enter this setup key in your authenticator.",
              )}
            </p>
            <output className="setup-key">
              {new URL(uri).searchParams.get("secret")}
            </output>
            <h3>{t("복구 코드 보관", "Keep your recovery codes")}</h3>
            <p className="muted">
              {t(
                "인증 앱을 쓸 수 없을 때 비밀번호와 함께 사용합니다. 각 코드는 한 번만 쓸 수 있으니 안전한 곳에 보관하세요.",
                "Use these with your password if your authenticator is unavailable. Each code works once; keep them somewhere safe.",
              )}
            </p>
            <ul
              className="recovery-code-list"
              aria-label={t("복구 코드 목록", "Recovery codes")}
            >
              {backupCodes.map((value) => (
                <li key={value}>
                  <output>{value}</output>
                </li>
              ))}
            </ul>
            <label className="check-label">
              <input
                type="checkbox"
                checked={savedCodes}
                disabled={busy}
                onChange={(event) => setSavedCodes(event.target.checked)}
              />
              <span>
                {t(
                  "복구 코드를 안전하게 보관했어요",
                  "I have saved my recovery codes safely",
                )}
              </span>
            </label>
            <div className="field">
              <label htmlFor="setup-code">
                {t("6자리 코드", "Six-digit code")}
              </label>
              <input
                id="setup-code"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </>
        )}
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn btn-primary"
          disabled={busy || Boolean(uri && !savedCodes)}
        >
          {busy ? t("확인 중", "Verifying") : t("확인", "Continue")}
        </button>
      </form>
    </AuthFrame>
  );
}
