import { LoginChallenge, type ChallengeMode } from "./LoginChallenge.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { signIn, verifyTotp, verifyRecoveryCode } from "./api.ts";
import { AuthFrame } from "./AuthFrame.tsx";
import { Icon, useLocale } from "./ui.tsx";

export function Login() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [email, setEmail] = useState("jay@local.test");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"password" | "totp">("password");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [mode, setMode] = useState<ChallengeMode>("totp");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        step === "password"
          ? await signIn(email, password)
          : mode === "recovery"
            ? await verifyRecoveryCode(code, trustDevice)
            : await verifyTotp(code, trustDevice);
      if (result.twoFactorRedirect) {
        setPassword("");
        setStep("totp");
        setMode("totp");
        setTrustDevice(false);
        setCode("");
        return;
      }
      if (result.code || result.message) {
        setError(
          result.code === "LOCKED"
            ? t(
                "실패한 로그인이 너무 많아요. 15분 뒤에 다시 시도해 주세요.",
                "Too many attempts. Try again in 15 minutes.",
              )
            : step === "password"
              ? t(
                  "이메일과 비밀번호를 확인해 주세요.",
                  "Check your email and password.",
                )
              : mode === "recovery"
                ? t(
                    "복구 코드가 맞지 않거나 이미 사용됐어요.",
                    "This recovery code is incorrect or already used.",
                  )
                : t(
                    "코드가 맞지 않거나 만료됐어요. 새 6자리를 입력해 주세요.",
                    "This code is incorrect or expired. Enter a new six-digit code.",
                  ),
        );
        return;
      }
      await qc.invalidateQueries({ queryKey: ["session"] });
      nav("/", { replace: true });
    } catch {
      setError(
        t(
          "연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
          "Couldn’t connect. Please try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame second={step === "totp"}>
      <header className="stack">
        <h2>
          {step === "password"
            ? t("Jay, 다시 오셨네요", "Welcome back, Jay")
            : mode === "recovery"
              ? t("복구 코드로 확인할게요", "Verify with a recovery code")
              : t("한 번 더 확인할게요", "One more check")}
        </h2>
        <p className="muted">
          {step === "password"
            ? t(
                "로그인하고 오늘의 작업을 이어가세요.",
                "Sign in to continue your work.",
              )
            : mode === "recovery"
              ? t(
                  "안전하게 보관한 복구 코드 하나를 입력해 주세요.",
                  "Enter one of your saved recovery codes.",
                )
              : t(
                  "인증 앱에 표시된 6자리 코드를 입력해 주세요.",
                  "Enter the six-digit code from your authenticator app.",
                )}
        </p>
      </header>
      <form className="login-form" onSubmit={submit}>
        {step === "password" ? (
          <>
            <div className="field">
              <label htmlFor="email">{t("이메일", "Email")}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t("비밀번호", "Password")}</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </div>
          </>
        ) : (
          <LoginChallenge
            mode={mode}
            code={code}
            trust={trustDevice}
            busy={busy}
            onCode={setCode}
            onTrust={setTrustDevice}
            onMode={(next) => {
              setMode(next);
              setCode("");
              setError(null);
              setTrustDevice(false);
            }}
          />
        )}
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn btn-primary"
          disabled={
            busy ||
            (step === "totp" &&
              (mode === "totp" ? code.length !== 6 : !code.trim()))
          }
        >
          {busy
            ? t("확인 중", "Verifying")
            : step === "password"
              ? t("로그인", "Sign in")
              : t("인증하고 시작하기", "Verify and continue")}
          <Icon name="arrow" />
        </button>
        {step === "totp" && (
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setStep("password");
              setTrustDevice(false);
              setError(null);
              setCode("");
            }}
          >
            {t("비밀번호부터 다시", "Back to password")}
          </button>
        )}
      </form>
    </AuthFrame>
  );
}
