import { useLocale } from "./ui.tsx";
export type ChallengeMode = "totp" | "recovery";
export function LoginChallenge({
  mode,
  code,
  trust,
  busy,
  onCode,
  onTrust,
  onMode,
}: {
  mode: ChallengeMode;
  code: string;
  trust: boolean;
  busy: boolean;
  onCode: (value: string) => void;
  onTrust: (value: boolean) => void;
  onMode: (value: ChallengeMode) => void;
}) {
  const { t } = useLocale();
  const recovery = mode === "recovery";
  return (
    <>
      <div className="field">
        <label htmlFor="challenge-code">
          {recovery
            ? t("복구 코드", "Recovery code")
            : t("6자리 코드", "Six-digit code")}
        </label>
        <input
          key={mode}
          autoFocus
          id="challenge-code"
          className={recovery ? undefined : "code-input"}
          inputMode={recovery ? "text" : "numeric"}
          pattern={recovery ? undefined : "[0-9]{6}"}
          minLength={recovery ? 1 : 6}
          maxLength={recovery ? 256 : 6}
          autoComplete="one-time-code"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          value={code}
          onChange={(event) =>
            onCode(
              recovery
                ? event.target.value
                : event.target.value.replace(/\D/g, "").slice(0, 6),
            )
          }
          placeholder={recovery ? "XXXXX-XXXXX" : "000000"}
          required
          disabled={busy}
        />
        <p className="muted">
          {recovery
            ? t(
                "각 복구 코드는 한 번만 사용할 수 있습니다.",
                "Each recovery code can be used only once.",
              )
            : t(
                "코드는 인증 앱에서 확인할 수 있어요.",
                "Find your code in your authenticator app.",
              )}
        </p>
      </div>
      <button
        type="button"
        className="text-btn"
        disabled={busy}
        onClick={() => onMode(recovery ? "totp" : "recovery")}
      >
        {recovery
          ? t("인증 앱 코드 사용", "Use authenticator code")
          : t("복구 코드 사용", "Use a recovery code")}
      </button>
      <div className="stack">
        <label className="check-label">
          <input
            type="checkbox"
            checked={trust}
            disabled={busy}
            onChange={(event) => onTrust(event.target.checked)}
          />
          <span>
            {t(
              "이 기기에서 30일 동안 인증 코드 생략",
              "Skip authenticator codes on this device for 30 days",
            )}
          </span>
        </label>
        <p className="muted">
          {t(
            "공용 기기에서는 선택하지 마세요. 로그인 유지 시간은 별도로 최대 12시간입니다.",
            "Do not select this on a shared device. Sign-ins still last no more than 12 hours.",
          )}
        </p>
      </div>
    </>
  );
}
