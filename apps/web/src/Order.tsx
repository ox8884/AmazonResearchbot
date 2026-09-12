import { useQuery } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router";
import { getCandidate } from "./api.ts";
import {MarketRisk} from './MarketRisk.tsx';
import {marketRiskOutcome} from '../../../packages/domain/src/market-risk-view.ts';
import { OrderDecisionForm } from "./OrderDecisionForm.tsx";
import { OrderPacketCard } from "./OrderPacketCard.tsx";
import { getOrderWorkspace } from "./order-api.ts";
import { getSourcing } from "./quote-api.ts";
import { Empty, LoadError, Loading, PageHeader, useLocale } from "./ui.tsx";

export function Order() {
  const { id } = useParams();
  const candidateId = id ?? "";
  const { language, t } = useLocale();
  const candidate = useQuery({
    queryKey: ["candidate", candidateId, language],
    queryFn: () => getCandidate(candidateId, language),
    refetchInterval: 5000,
    enabled: Boolean(id),
  });
  const workspace = useQuery({
    queryKey: ["orders", candidateId],
    queryFn: () => getOrderWorkspace(candidateId),
    refetchInterval: 5000,
    enabled: Boolean(id),
  });
  const sourcing = useQuery({
    queryKey: ["sourcing", candidateId],
    queryFn: () => getSourcing(candidateId),
    enabled: Boolean(id),
  });

  async function refresh() {
    await Promise.all([candidate.refetch(), workspace.refetch(), sourcing.refetch()]);
  }

  if (!id)
    return (
      <Empty
        title={t("후보를 찾을 수 없어요", "Candidate not found")}
        description={t(
          "후보 목록에서 발주 판단 대상을 다시 선택해 주세요.",
          "Select a candidate before reviewing an order decision.",
        )}
        to="/candidates"
        action={t("후보 보기", "View candidates")}
      />
    );
  if (candidate.isPending || workspace.isPending || sourcing.isPending)
    return <Loading />;
  if (
    (candidate.isError && !candidate.data) ||
    (workspace.isError && !workspace.data) ||
    (sourcing.isError && !sourcing.data)
  )
    return (
      <LoadError
        retry={() => {
          void refresh();
        }}
      />
    );
  if (!candidate.data || !workspace.data || !sourcing.data)
    return (
      <Empty
        title={t("발주 판단 정보를 찾을 수 없어요", "Order decision data not found")}
        description={t(
          "후보와 견적 정보를 다시 확인해 주세요.",
          "Check the candidate and quote information, then try again.",
        )}
        to={`/candidates/${encodeURIComponent(candidateId)}`}
        action={t("후보 상세로", "Back to candidate")}
      />
    );

  const { budget, packets, reservations, settingsVersion } = workspace.data;
  const validation=candidate.isError||workspace.isError||sourcing.isError?undefined:candidate.data.validation;
  const marketReady=validation?.status==='pass'&&validation.settingsVersion===settingsVersion&&marketRiskOutcome(validation.marketRisk)==='GO';
  const hasHistory = packets.length > 0;
  const orderedPackets = [...packets].sort((a, b) =>
    Number(b.state === "pending_approval") - Number(a.state === "pending_approval") ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const history = (
    <section className="order-history stack">
      <header className="section-label">
        <h2>{t("기록된 판단", "Recorded decisions")}</h2>
        <p className="muted">{packets.length}</p>
      </header>
      {packets.length ? (
        <div className="order-packet-list">
          {orderedPackets.map((packet) => (
            <OrderPacketCard
              key={packet.id}
              packet={packet}
              marketReady={marketReady}
              reservation={reservations.find(
                (reservation) => reservation.orderPacketId === packet.id,
              )}
              onChanged={refresh}
            />
          ))}
        </div>
      ) : (
        <p className="muted">
          {t(
            "아직 기록한 발주 판단이 없어요.",
            "No order decisions have been recorded yet.",
          )}
        </p>
      )}
    </section>
  );
  return (
    <div className="order-page stack">
      <NavLink
        className="back-link"
        to={`/candidates/${encodeURIComponent(candidateId)}`}
      >
        {t("후보 상세로", "Back to candidate")}
      </NavLink>
      <PageHeader
        eyebrow={t("발주 판단", "Order decision")}
        title={candidate.data.candidate.keyword}
        description={t(
          "견적 기반 판단과 출시 현금 예약을 기록합니다. 실제 주문·결제·공급처 전송은 하지 않습니다.",
          "Record quote-based decisions and launch-cash reservations. No actual order, payment, or supplier contact occurs here.",
        )}
      >
        <span className="chip chip-quote">{t("적용 기준", "Applied criteria")} · v{settingsVersion}</span>
      </PageHeader>
      {(candidate.isError || workspace.isError || sourcing.isError) && (
        <p className="banner" role="status">
          {t(
            "최신 상태를 불러오지 못했어요. 마지막으로 열린 내용을 보여드립니다.",
            "Couldn’t refresh the status. Showing the last loaded content.",
          )}
        </p>
      )}
      <section className="order-boundary" role="status">
        <h2>{t("기록 범위", "What this records")}</h2>
        <p>
          {t(
            "판단 기록과 출시 현금 예약만 바뀝니다.",
            "Only decision records and cash reservations change.",
          )}
        </p>
      </section>
      <section className="order-budget-line" aria-label={t("출시 현금 현황", "Launch-cash budget")}>
        <strong>{t("출시 현금", "Launch cash")}</strong>
        <span>
          {t("한도", "Limit")} USD {budget.limitUsd} · {t("예약됨", "Reserved")} USD {budget.reservedUsd} · {t("사용 가능", "Available")} USD {budget.availableUsd}
        </span>
      </section>
      <MarketRisk view={validation}/>
      {hasHistory ? history : null}
      <OrderDecisionForm
        key={candidateId}
        candidateId={candidateId}
        quotes={sourcing.data.quotes}
        marketReady={marketReady}
        onRecorded={refresh}
      />
      {hasHistory ? null : history}
    </div>
  );
}
