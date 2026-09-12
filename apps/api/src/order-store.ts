import type { Pool } from "@forge-ops/db";
import type {
  LaunchCashReservationRecord,
  OrderBudget,
  OrderPacketRecord,
  OrderPacketPayload,
} from "@forge-ops/domain";
import { orderPacketPayloadSchema } from "./order-schema.ts";

export type OrderConnection = Pick<Pool, "query">;

export type OrderPacketRow = {
  id: string;
  candidate_id: string;
  quote_id: string;
  spec_id: string;
  settings_version: number;
  decision: OrderPacketRecord["decision"];
  note: string;
  payload: unknown;
  payload_hash: string;
  approval_id: string | null;
  approval_status: string | null;
  state: OrderPacketRecord["state"];
  created_at: Date;
};

export type LaunchCashReservationRow = {
  id: string;
  candidate_id: string;
  order_packet_id: string;
  approval_id: string;
  raw_usd: string;
  reserved_usd: string;
  state: LaunchCashReservationRecord["state"];
  released_at: Date | null;
  released_by: string | null;
  release_note: string | null;
  created_at: Date;
};

function packetPayload(value: unknown): OrderPacketPayload {
  const parsed = orderPacketPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("Stored order packet cannot be read");
  return parsed.data;
}

export function orderPacketView(row: OrderPacketRow): OrderPacketRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    quoteId: row.quote_id,
    specId: row.spec_id,
    settingsVersion: row.settings_version,
    decision: row.decision,
    note: row.note,
    state: row.state,
    approvalId: row.approval_id,
    approvalStatus: row.approval_status,
    createdAt: row.created_at.toISOString(),
    snapshot: packetPayload(row.payload),
  };
}

export function reservationView(
  row: LaunchCashReservationRow,
): LaunchCashReservationRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    orderPacketId: row.order_packet_id,
    approvalId: row.approval_id,
    rawUsd: row.raw_usd,
    reservedUsd: row.reserved_usd,
    state: row.state,
    releasedAt: row.released_at?.toISOString() ?? null,
    releasedBy: row.released_by,
    releaseNote: row.release_note,
    createdAt: row.created_at.toISOString(),
  };
}

export async function orderBudget(
  db: OrderConnection,
  limitUsd: string,
): Promise<OrderBudget> {
  const result = await db.query<{
    limit_usd: string;
    reserved_usd: string;
    available_usd: string;
  }>(
    `SELECT $1::numeric::text AS limit_usd,
      coalesce(sum(reserved_usd) FILTER (WHERE state='active'), 0)::text AS reserved_usd,
      greatest($1::numeric-coalesce(sum(reserved_usd) FILTER (WHERE state='active'), 0), 0)::text AS available_usd
     FROM launch_cash_reservations`,
    [limitUsd],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Launch cash budget unavailable");
  return {
    limitUsd: row.limit_usd,
    reservedUsd: row.reserved_usd,
    availableUsd: row.available_usd,
  };
}
