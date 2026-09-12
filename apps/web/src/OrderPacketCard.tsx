import { OrderEvidence } from "./OrderEvidence.tsx";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { LaunchCashReservationRecord, OrderPacketRecord } from "../../../packages/domain/src/order.ts";
import {
  cancelOrderPacket,
  decideOrderApproval,
  getOrderPacket,
  OrderRequestError,
} from "./order-api.ts";
import { Icon, Loading, useLocale } from "./ui.tsx";

function decisionLabel(decision: OrderPacketRecord["decision"], language: string): string {
  switch (decision) {
    case "go":
      return "GO";
    case "hold":
      return language === "ko" ? "보류" : "Hold";
    case "reject":
      return language === "ko" ? "탈락" : "Rejected";
    default: {
      const impossible: never = decision;
      return impossible;
    }
  }
}

function stateLabel(state: OrderPacketRecord["state"], language: string, approvalStatus: string | null): string {
  switch (state) {
    case "pending_approval":
      return language === "ko" ? "승인 대기" : "Pending approval";
    case "recorded":
      return language === "ko" ? "결정 기록됨" : "Decision recorded";
    case "stale":
      return language === "ko" ? "기준 변경됨" : "Criteria changed";
    case "cancelled":
      if (approvalStatus === "rejected") return language === "ko" ? "판단 거절됨" : "Decision rejected";
      return language === "ko" ? "예약 취소됨" : "Reservation cancelled";
    default: {
      const impossible: never = state;
      return impossible;
    }
  }
}

export function OrderPacketCard({
  packet,
  marketReady,
  reservation,
  onChanged,
}: {
  packet: OrderPacketRecord;
  marketReady: boolean;
  reservation: LaunchCashReservationRecord | undefined;
  onChanged: () => Promise<void>;
}) {
  const { language, t } = useLocale();
  const [releaseNote, setReleaseNote] = useState("");
  const detailedPacket = useQuery({
    queryKey: ["order-packet", packet.id],
    queryFn: () => getOrderPacket(packet.id),
    enabled: packet.state === "pending_approval",
  });
  const approval = useMutation({
    mutationFn: (input: {
      readonly approvalId: string;
      readonly decision: "approve" | "reject";
    }) => decideOrderApproval(input.approvalId, input.decision),
    onSuccess: onChanged,
    onError: onChanged,
  });
  const cancellation = useMutation({
    mutationFn: (input: { readonly packetId: string; readonly note: string }) => cancelOrderPacket(input.packetId, input.note),
    onSuccess: async () => {
      setReleaseNote("");
      await onChanged();
    },
  });
  const snapshot = detailedPacket.data?.packet.snapshot ?? packet.snapshot;
  const decisionReady = detailedPacket.isSuccess;
  const activeReservation = reservation?.state === "active" ? reservation : undefined;

  function decide(decision: "approve" | "reject") {
    if (!packet.approvalId) return;
    approval.mutate({ approvalId: packet.approvalId, decision });
  }

  return (
    <article className="card order-packet">
      <header className="order-packet-heading">
        <div className="stack">
          <h3>{decisionLabel(packet.decision, language)}</h3>
          <p className="muted">
            {t("판단 기록", "Decision record")} · {new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {dateStyle:"medium", timeStyle:"short"}).format(new Date(packet.createdAt))}
          </p>
        </div>
        <span className={`chip chip-${packet.state === "recorded" ? "ok" : packet.state === "stale" || packet.state === "cancelled" ? "warn" : "quote"}`}>
          {stateLabel(packet.state, language, packet.approvalStatus)}
        </span>
      </header>
      <p>{packet.note}</p>
      {reservation?.state === "released" && <p className="muted">
        {t("예약 해제 사유", "Reservation release note")}: {reservation.releaseNote ?? t("미확인", "Unknown")}
      </p>}
      <details className="order-packet-snapshot" open={packet.state === "pending_approval"}>
        <summary>{t("판단에 사용한 견적·사양", "Quote and specification used")}</summary>
        {packet.state === "pending_approval" && detailedPacket.isPending ? (
          <Loading />
        ) : detailedPacket.isError && packet.state === "pending_approval" ? (
          <p className="banner" role="alert">
            {t(
              "승인에 사용할 견적·사양 정보를 다시 불러오지 못했어요. 승인은 잠시 막아 두었습니다.",
              "Couldn’t reload the quote and specification used for approval. Approval is temporarily unavailable.",
            )}
          </p>
        ) : (
          <OrderEvidence snapshot={snapshot} />
        )}
      </details>
      {packet.state === "pending_approval" && (
        <section className="order-packet-actions">
          {packet.decision==='go'&&!marketReady&&<p className="banner">{t('현재 공식 평가 또는 시장 조건을 확인해야 합니다. GO 승인은 보류됩니다.','GO approval waits for current official validation and market criteria.')}</p>}
          <div className="btn-row">
            <button className="btn btn-primary"
              disabled={!packet.approvalId || !decisionReady || approval.isPending || (packet.decision==='go'&&!marketReady)}
              onClick={() => decide("approve")}
            >
              {approval.isPending
                ? t("처리 중", "Processing")
                : t("이 판단 승인", "Approve this decision")}
            </button>
            <button className="btn btn-secondary"
              disabled={!packet.approvalId || approval.isPending}
              onClick={() => decide("reject")}
            >
              {t("이 판단 거절", "Reject this decision")}
            </button>
          </div>
          {approval.isError && (
            <p className="banner" role="alert">
              {approval.error instanceof OrderRequestError && approval.error.code === "INSUFFICIENT_LAUNCH_CASH"
                ? t("사용 가능한 출시 현금이 부족합니다. 기존 예약을 검토한 뒤 다시 승인해 주세요.", "Available launch cash is insufficient. Review existing reservations before approving again.")
                : approval.error instanceof OrderRequestError && approval.error.code === "APPROVAL_STALE"
                  ? t("기준이나 근거가 바뀌었습니다. 현재 견적으로 새 판단을 작성해 주세요.", "Criteria or evidence changed. Create a new decision using the current quote.")
                  : t("결정 결과를 확인하지 못했어요. 판단 상태를 다시 불러와 확인해 주세요.", "Couldn’t confirm the decision. Reload the decision status and review it again.")}
            </p>
          )}
        </section>
      )}
      {packet.state === "recorded" && activeReservation && (
        <form
          className="order-release"
          onSubmit={(event) => {
            event.preventDefault();
            if (!releaseNote.trim() || cancellation.isPending) return;
            cancellation.mutate({ packetId: packet.id, note: releaseNote.trim() });
          }}
        >
          <p className="muted">
            {t(
              "이 작업은 기록된 출시 현금 예약만 해제합니다. 주문·결제·공급처 전송은 하지 않습니다.",
              "This releases only the recorded launch-cash reservation. It does not order, pay, or contact a supplier.",
            )}
          </p>
          <div className="field">
            <label htmlFor={`release-note-${packet.id}`}>
              {t("예약 취소 사유", "Reservation release note")}
            </label>
            <input
              id={`release-note-${packet.id}`}
              required
              value={releaseNote}
              onChange={(event) => setReleaseNote(event.target.value)}
            />
          </div>
          <button className="btn btn-secondary" disabled={cancellation.isPending}>
            {cancellation.isPending
              ? t("예약 해제 중", "Releasing")
              : t("출시 현금 예약 취소", "Cancel launch-cash reservation")}
          </button>
          {cancellation.isError && (
            <p className="banner" role="alert">
              {t(
                "예약 해제 결과를 확인하지 못했어요. 현재 기록을 다시 불러와 확인해 주세요.",
                "Couldn’t confirm the release. Reload the current record to check it.",
              )}
            </p>
          )}
        </form>
      )}
    </article>
  );
}
