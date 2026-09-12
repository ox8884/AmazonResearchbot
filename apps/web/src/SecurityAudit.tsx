import { useQuery } from "@tanstack/react-query";
import { listSecurityAudit } from "./security-api.ts";
import { Loading, LoadError, useLocale } from "./ui.tsx";

export function SecurityAudit() {
  const { t, language } = useLocale();
  const query = useQuery({
    queryKey: ["security-audit"],
    queryFn: listSecurityAudit,
  });
  const actions = {
    approve: t("승인 기록됨", "Approval recorded"),
    reject: t("거절 기록됨", "Rejection recorded"),
    approval_invalidated: t("승인 무효 처리됨", "Approval invalidated"),
    session_revoked: t("다른 기기 로그아웃", "Another device signed out"),
    trusted_device_revoked: t("기기 인증 생략 해제", "Device trust revoked"),
  };
  const kinds = {
    supplier_contact: t("공급처 연락", "Supplier contact"),
    order_decision: t("발주 판단", "Order decision"),
    budget_or_criteria_change: t("예산·기준 변경", "Budget or criteria change"),
    provider_activation: t("연결·테스트 사용", "Provider or test access"),
  };
  const date = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section className="detail-section stack">
      <div className="section-label">
        <h2>{t("내 승인·기기 기록", "My approvals and devices")}</h2>
        <button
          className="btn btn-secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("기록 다시 확인", "Refresh history")}
        </button>
      </div>
      <p className="muted">
        {t(
          "현재 계정이 남긴 최근 승인·거절·기기 해제 50건입니다. 시각은 이 기기 기준입니다. 승인은 실제 전송 완료를 뜻하지 않습니다.",
          "The latest 50 approval, rejection and device revocation records by this account. Times use this device’s time zone. Approval does not confirm delivery.",
        )}
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <LoadError retry={() => void query.refetch()} />
      ) : (
        <>
          {query.isError && <LoadError retry={() => void query.refetch()} />}
          {!query.data?.events.length && (
            <p className="muted">
              {t("아직 표시할 기록이 없어요.", "No records to show yet.")}
            </p>
          )}
          {query.data?.events.map((event) => (
            <article className="connection-row" key={event.id}>
              <div className="stack">
                <h3>{actions[event.action]}</h3>
                <p>
                  {event.approvalKind
                    ? kinds[event.approvalKind]
                    : event.action === "session_revoked" ||
                        event.action === "trusted_device_revoked"
                      ? t("로그인 기기", "Signed-in device")
                      : t("승인 대상 미확인", "Approval subject unknown")}
                  {event.candidateKeyword && ` · ${event.candidateKeyword}`}
                </p>
                <p className="muted">
                  {t("실행한 계정 · 현재 계정", "Performed by · This account")}{" "}
                  ·{" "}
                  <time dateTime={event.createdAt}>
                    {date.format(new Date(event.createdAt))}
                  </time>
                </p>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
