import type {
  LaunchCashReservationRecord,
  OrderBudget,
  OrderDecision,
  OrderPacketRecord,
} from "../../../packages/domain/src/order.ts";
import type {OrderRiskReview} from "../../../packages/domain/src/order-risk-review.ts";
import { requestJson } from "./api.ts";

export type OrderWorkspace = {
  readonly packets: readonly OrderPacketRecord[];
  readonly reservations: readonly LaunchCashReservationRecord[];
  readonly budget: OrderBudget;
  readonly settingsVersion: number;
};

export type RecordedOrderPacket = {
  readonly packet: OrderPacketRecord;
  readonly approvalId: string;
};

export class OrderRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const request = <T>(path: string, options?: { readonly body?: unknown }) =>
  requestJson<T>(path, OrderRequestError, options);

export const getOrderWorkspace = (candidateId: string) =>
  request<OrderWorkspace>(
    `/api/candidates/${encodeURIComponent(candidateId)}/orders`,
  );

export const getOrderPacket = (packetId: string) =>
  request<{ readonly packet: OrderPacketRecord }>(
    `/api/order-packets/${encodeURIComponent(packetId)}`,
  );

export const createOrderPacket = (
  candidateId: string,
  input: {
    readonly quoteId: string;
    readonly decision: OrderDecision;
    readonly note: string;
    readonly riskReview?: OrderRiskReview;
  },
) =>
  request<RecordedOrderPacket>(
    `/api/candidates/${encodeURIComponent(candidateId)}/order-packets`,
    { body: input },
  );

export const decideOrderApproval = (
  approvalId: string,
  decision: "approve" | "reject",
) =>
  request<unknown>(
    `/api/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    { body: {} },
  );

export const cancelOrderPacket = (packetId: string, note: string) =>
  request<unknown>(`/api/order-packets/${encodeURIComponent(packetId)}/cancel`, {
    body: { note },
  });
