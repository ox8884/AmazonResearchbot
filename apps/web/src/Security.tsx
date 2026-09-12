import { SecurityAudit } from "./SecurityAudit.tsx";
import { RecoveryCodesPanel } from "./RecoveryCodesPanel.tsx";
import { TrustedDevices } from "./TrustedDevices.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import type { LoginSession } from "../../../packages/domain/src/login-session.ts";
import {
  listLoginSessions,
  revokeLoginSession,
  signOut,
  SecurityRequestError,
} from "./security-api.ts";
import {
  Icon,
  LoadError,
  Loading,
  PageHeader,
  Stage,
  useLocale,
} from "./ui.tsx";
export function Security() {
  const { t, language } = useLocale(),
    qc = useQueryClient(),
    navigate = useNavigate();
  const query = useQuery({
    queryKey: ["login-sessions"],
    queryFn: listLoginSessions,
    retry: false,
  });
  const [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const date = (value: string) =>
    new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  async function revoke(id: string) {
    if (busy) return;
    setBusy(id);
    setNotice(null);
    try {
      await revokeLoginSession(id);
      qc.setQueryData<{ sessions: LoginSession[] }>(
        ["login-sessions"],
        (current) =>
          current
            ? {
                sessions: current.sessions.filter(
                  (session) => session.id !== id,
                ),
              }
            : current,
      );
      setNotice(
        t(
          "다른 기기의 로그인을 종료했어요. 현재 기기의 로그인은 유지됩니다.",
          "The other device is signed out. This device remains signed in.",
        ),
      );
      void query.refetch();
    } catch (error) {
      setNotice(
        error instanceof SecurityRequestError && error.status === 404
          ? t(
              "이미 종료됐거나 찾을 수 없는 로그인입니다. 목록을 다시 확인해 주세요.",
              "This sign-in has already ended or cannot be found. Refresh the list.",
            )
          : t(
              "로그아웃 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.",
              "Could not confirm sign-out. Refresh the list.",
            ),
      );
    } finally {
      setBusy(null);
    }
  }
  async function leave() {
    if (busy) return;
    setBusy("current");
    setNotice(null);
    try {
      await signOut();
      await qc.cancelQueries();
      qc.setQueryData(["session"], null);
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      navigate("/login", { replace: true });
    } catch {
      setNotice(
        t(
          "로그아웃하지 못했어요. 다시 시도해 주세요.",
          "Could not sign out. Please retry.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <NavLink className="back-link" to="/settings">
        {t("설정으로", "Back to settings")}
      </NavLink>
      <PageHeader
        title={t("로그인한 기기", "Signed-in devices")}
        description={t(
          "내 기기의 로그인을 확인하고, 사용하지 않는 기기는 로그아웃하세요.",
          "Review your sign-ins and sign out devices you no longer use.",
        )}
      />
      <section className="quiet stack">
        <h2>{t("2단계 인증 사용 중", "Two-step verification enabled")}</h2>
        <p className="muted">
          {t(
            "로그인은 최대 12시간 유지됩니다. 아래 시각은 현재 기기의 시간대입니다.",
            "Sign-ins last up to 12 hours. Times below use this device’s time zone.",
          )}
        </p>
      </section>
      {notice && (
        <p className="banner" role="status">
          {notice}
        </p>
      )}
      <div className="btn-row">
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("목록 다시 확인", "Refresh list")}
        </button>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <LoadError retry={() => void query.refetch()} />
      ) : (
        <>
          {query.isError && <LoadError retry={() => void query.refetch()} />}
          {query.data?.sessions.map((session) => (
            <article className="detail-section" key={session.id}>
              <div className="section-label">
                <h2>
                  {session.device ?? t("기기 정보 미확인", "Device unknown")}
                </h2>
                {session.current && (
                  <Stage>{t("현재 기기", "This device")}</Stage>
                )}
              </div>
              <dl className="quote-terms">
                <div>
                  <dt>{t("로그인 시각", "Signed in")}</dt>
                  <dd>{date(session.createdAt)}</dd>
                </div>
                <div>
                  <dt>{t("로그인 만료", "Expires")}</dt>
                  <dd>{date(session.expiresAt)}</dd>
                </div>
                <div>
                  <dt>{t("접속 주소", "Connection address")}</dt>
                  <dd>{session.address?.trim() || t("미확인", "Unknown")}</dd>
                </div>
              </dl>
              <div className="btn-row">
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void (session.current ? leave() : revoke(session.id))
                  }
                >
                  <Icon name="shield" />
                  {busy === (session.current ? "current" : session.id)
                    ? t("로그아웃 중", "Signing out")
                    : session.current
                      ? t("현재 기기 로그아웃", "Sign out this device")
                      : t("이 기기 로그아웃", "Sign out this device")}
                </button>
              </div>
            </article>
          ))}
          {query.data?.sessions.length === 0 && (
            <p>
              {t(
                "현재 확인되는 로그인이 없어요. 다시 로그인해 주세요.",
                "No active sign-ins were found. Please sign in again.",
              )}
            </p>
          )}
        </>
      )}
      <TrustedDevices />
      <p className="muted">
        {t(
          "기기 이름은 브라우저가 제공한 정보입니다. 같은 기기에서 여러 번 로그인하면 각각 표시될 수 있습니다.",
          "Device names use browser-provided information. Multiple sign-ins on one device may appear separately.",
        )}
      </p>
      <RecoveryCodesPanel />
      <SecurityAudit />
    </>
  );
}
