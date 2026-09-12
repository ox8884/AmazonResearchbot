import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  SecurityRequestError,
} from "./security-api.ts";
import { LoadError, Loading, useLocale } from "./ui.tsx";
export function RecoveryCodesPanel() {
  const { t } = useLocale(),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["recovery-code-status"],
    queryFn: getRecoveryCodeStatus,
    retry: false,
  });
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [codes, setCodes] = useState<string[] | null>(null),
    [saved, setSaved] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  async function issue(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await generateRecoveryCodes(password);
      if (
        !Array.isArray(result.backupCodes) ||
        !result.backupCodes.length ||
        !result.backupCodes.every(
          (code) => typeof code === "string" && code.length > 0,
        )
      )
        throw new Error("Recovery code response unavailable");
      setCodes(result.backupCodes);
      setSaved(false);
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["recovery-code-status"] });
    } catch (error) {
      setNotice(
        error instanceof SecurityRequestError && error.status === 423
          ? t(
              "실패한 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.",
              "Too many failed attempts. Try again in 15 minutes.",
            )
          : error instanceof SecurityRequestError && error.status === 400
            ? t("비밀번호를 확인해 주세요.", "Check your password.")
            : t(
                "발급 결과를 확인하지 못했어요. 다시 발급하면 이전 코드는 사용할 수 없습니다.",
                "Could not confirm the new codes. Issuing another set invalidates previous codes.",
              ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-section">
      <h2>{t("복구 코드", "Recovery codes")}</h2>
      <p className="muted">
        {t(
          "인증 앱을 사용할 수 없을 때 비밀번호와 함께 로그인합니다. 각 코드는 한 번만 사용할 수 있습니다.",
          "Use these with your password if your authenticator is unavailable. Each code can be used once.",
        )}
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <LoadError retry={() => void query.refetch()} />
      ) : (
        <p>
          {query.data?.remaining == null
            ? t("남은 코드 수 미확인", "Remaining code count unknown")
            : t(
                `남은 복구 코드 ${query.data.remaining}개`,
                `Recovery codes remaining: ${query.data.remaining}`,
              )}
        </p>
      )}
      {notice && (
        <p className="banner" role="status">
          {notice}
        </p>
      )}
      {codes ? (
        <div className="stack">
          <p>
            {t(
              "이 화면을 닫으면 코드를 다시 볼 수 없습니다. 안전한 곳에 보관해 주세요.",
              "These codes cannot be shown again after closing this view. Keep them somewhere safe.",
            )}
          </p>
          <ul
            className="recovery-code-list"
            aria-label={t("새 복구 코드 목록", "New recovery codes")}
          >
            {codes.map((code) => (
              <li key={code}>
                <output>{code}</output>
              </li>
            ))}
          </ul>
          <label className="check-label">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
            />
            <span>
              {t(
                "복구 코드를 안전하게 보관했어요",
                "I have saved my recovery codes safely",
              )}
            </span>
          </label>
          <div className="btn-row">
            <button
              className="btn btn-secondary"
              disabled={!saved}
              onClick={() => {
                setCodes(null);
                setSaved(false);
                setNotice(
                  t("코드 표시를 닫았어요.", "The code display is closed."),
                );
              }}
            >
              {t("코드 표시 닫기", "Close code display")}
            </button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={issue}>
          <p className="banner">
            {t(
              "새 코드를 발급하면 이전 복구 코드는 모두 사용할 수 없습니다.",
              "Issuing new codes invalidates every previous recovery code.",
            )}
          </p>
          <div className="field">
            <label htmlFor="recovery-password">
              {t("현재 비밀번호", "Current password")}
            </label>
            <input
              id="recovery-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <div className="btn-row">
            <button className="btn btn-secondary" disabled={busy || !password}>
              {busy
                ? t("발급 중", "Issuing codes")
                : t("새 복구 코드 발급", "Issue new recovery codes")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
