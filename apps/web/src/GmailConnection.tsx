import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  gmailStatus,
  gmailConnect,
  gmailRefresh,
  ConnectionError,
} from "./connections-api.ts";
import { useLocale, LoadError, Loading } from "./ui.tsx";
export function GmailConnection() {
  const { t } = useLocale(),
    qc = useQueryClient();
  const q = useQuery({
    queryKey: ["gmail-connection"],
    queryFn: gmailStatus,
    retry: false,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function act(action: "connect" | "refresh") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "refresh") {
        qc.setQueryData(["gmail-connection"], await gmailRefresh());
        return;
      }
      const result = await gmailConnect();
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      if (result.alreadyConnected) {
        qc.setQueryData(["gmail-connection"], await gmailStatus());
        return;
      }
      setError(
        t(
          "인증 링크를 확인하지 못했어요. 다시 시도해 주세요.",
          "Could not confirm the authentication link. Please retry.",
        ),
      );
    } catch (e) {
      setError(
        e instanceof ConnectionError && e.code === "COMPOSIO_NOT_CONFIGURED"
          ? t(
              "Composio MCP 키를 먼저 설정해 주세요.",
              "Set the Composio MCP key first.",
            )
          : e instanceof ConnectionError &&
              e.code === "COMPOSIO_CREDENTIAL_REJECTED"
            ? t(
                "Composio MCP 키를 확인해 주세요.",
                "Check the Composio MCP key.",
              )
            : t(
                "연결을 확인하지 못했어요. 연결됨으로 처리하지 않았습니다. 잠시 뒤 다시 확인해 주세요.",
                "Could not verify the connection. It has not been marked connected. Try again shortly.",
              ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (q.isPending) return <Loading />;
  if (q.isError && !q.data) return <LoadError retry={() => void q.refetch()} />;
  const data = q.data;
  return (
    <section className="detail-section stack">
      <div className="section-label">
        <h2>Gmail · Composio</h2>
        <span
          className={
            "chip " +
            (data?.status === "active" ? "chip-success" : "chip-unknown")
          }
        >
          {data?.status === "active"
            ? t("Google 인증 확인됨", "Google authentication verified")
            : data?.status === "pending"
              ? t("인증 대기", "Awaiting authentication")
              : data?.status === "expired"
                ? t("재인증 필요", "Reconnect required")
                : data?.status === "mismatch"
                  ? t("계정 확인 필요", "Check account")
                  : t("연결 전", "Not connected")}
        </span>
      </div>
      <p className="muted">
        {t(
          "Google 로그인으로 연결합니다. Gmail 비밀번호를 Forge에 입력하지 않습니다.",
          "Connect through Google sign-in. Do not enter your Gmail password in Forge.",
        )}
      </p>
      {data?.expectedEmail && (
        <p>
          {t("연결할 업무 계정", "Expected work account")}: {data.expectedEmail}
        </p>
      )}
      {data?.email && (
        <p>
          {t("확인된 계정", "Verified account")}: {data.email}
        </p>
      )}
      {data?.checkedAt && (
        <p className="muted">
          {t("마지막 확인", "Last checked")}:{" "}
          {new Date(data.checkedAt).toLocaleString()}
        </p>
      )}
      {!data?.configured && (
        <div className="banner stack">
          <p>
            {t(
              "Composio MCP 연결을 먼저 준비해 주세요.",
              "Prepare the Composio MCP connection first.",
            )}
          </p>
          <p>
            {t(
              "프로젝트의 .env.composio 파일에 COMPOSIO_API_KEY를 입력한 뒤 서버를 다시 시작하면 인증 버튼이 활성화됩니다.",
              "Set COMPOSIO_API_KEY in the project’s .env.composio file and restart the server to enable authentication.",
            )}
          </p>
          <a
            className="text-btn"
            href="https://dashboard.composio.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Composio 설정 열기", "Open Composio settings")}
          </a>
        </div>
      )}
      {data?.status === "mismatch" && (
        <p className="banner">
          {t(
            "선택한 Google 계정이 업무 계정과 다릅니다. Composio에서 연결 계정을 확인한 뒤 업무 계정으로 다시 인증해 주세요.",
            "The selected Google account differs from your work account. Review the connection in Composio, then reconnect the work account.",
          )}
        </p>
      )}
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      {q.isError && <LoadError retry={() => void q.refetch()} />}
      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={busy || !data?.configured}
          onClick={() => void act("connect")}
        >
          {busy
            ? t("확인 중", "Checking")
            : data?.status === "active"
              ? t("Gmail 연결 확인", "Check Gmail connection")
              : t("Google로 Gmail 연결", "Connect Gmail with Google")}
        </button>
        <button
          className="btn btn-secondary"
          disabled={
            busy || !data?.configured || data.status === "not_connected"
          }
          onClick={() => void act("refresh")}
        >
          {t("인증 결과 확인", "Check authentication result")}
        </button>
      </div>
      <p className="muted">
        {t(
          "인증 창에서 돌아오면 인증 결과를 확인하세요. 연결 세션은 서버에 보관됩니다. 자동 요약·회신 수집의 실행 연결은 별도로 준비 중이며 이 화면은 메일을 보내거나 읽지 않습니다.",
          "After returning from authentication, check the result. The server retains the connection session. Scheduled summaries and reply collection are being integrated separately; this screen does not send or read messages.",
        )}
      </p>
    </section>
  );
}
