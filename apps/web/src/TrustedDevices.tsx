import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { TrustedDevice } from "../../../packages/domain/src/login-session.ts";
import { listTrustedDevices, revokeTrustedDevice } from "./security-api.ts";
import { LoadError, Loading, useLocale } from "./ui.tsx";
export function TrustedDevices() {
  const { t, language } = useLocale(),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["trusted-devices"],
    queryFn: listTrustedDevices,
    retry: false,
  });
  const [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : t("미확인", "Unknown");
  async function remove(id: string) {
    if (busy) return;
    setBusy(id);
    setNotice(null);
    try {
      await revokeTrustedDevice(id);
      qc.setQueryData<{ devices: TrustedDevice[] }>(
        ["trusted-devices"],
        (current) =>
          current
            ? { devices: current.devices.filter((device) => device.id !== id) }
            : current,
      );
      setNotice(
        t(
          "기기 기억을 해제했어요. 현재 로그인은 유지되고, 다음 로그인부터 인증 코드가 필요합니다.",
          "Device trust removed. Current sign-ins remain active; the next sign-in requires an authenticator code.",
        ),
      );
      void query.refetch();
    } catch {
      setNotice(
        t(
          "해제 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.",
          "Could not confirm removal. Refresh the list.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="detail-section">
      <div className="section-label">
        <h2>{t("기억한 기기", "Remembered devices")}</h2>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("기기 기억 다시 확인", "Refresh remembered devices")}
        </button>
      </div>
      <p className="muted">
        {t(
          "인증 코드를 생략하도록 선택한 기기입니다. 비밀번호는 여전히 필요하며, 로그인할 때 기억 기간을 30일로 갱신합니다. 로그인 유지 시간과는 별개입니다.",
          "These devices can skip authenticator codes. A password is still required, and each sign-in renews trust for 30 days. This is separate from session duration.",
        )}
      </p>
      {notice && (
        <p className="banner" role="status">
          {notice}
        </p>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <LoadError retry={() => void query.refetch()} />
      ) : (
        <>
          {query.isError && <LoadError retry={() => void query.refetch()} />}
          {query.data?.devices.length === 0 && (
            <p>
              {t(
                "기억한 기기가 없어요. 로그인할 때 선택할 수 있습니다.",
                "No devices are remembered. You can choose this when signing in.",
              )}
            </p>
          )}
          {query.data?.devices.map((device) => (
            <article key={device.id} className="detail-section">
              <h3>
                {device.device ?? t("기기 정보 미확인", "Device unknown")}
              </h3>
              <dl className="quote-terms">
                <div>
                  <dt>{t("기억 갱신 시각", "Trust renewed")}</dt>
                  <dd>{date(device.createdAt)}</dd>
                </div>
                <div>
                  <dt>{t("기억 만료", "Trust expires")}</dt>
                  <dd>{date(device.expiresAt)}</dd>
                </div>
              </dl>
              <div className="btn-row">
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void remove(device.id)}
                >
                  {busy === device.id
                    ? t("해제 중", "Removing")
                    : t("이 기기 기억 해제", "Forget this device")}
                </button>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
