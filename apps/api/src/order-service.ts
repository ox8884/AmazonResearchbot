import type { QueryConnection } from "@forge-ops/db";
import {
  orderSourceSnapshot,
  reserveCash,
  type OrderPacketPayload,
} from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import type { ApprovalRow } from "./approval-types.ts";
import { orderPacketPayloadSchema } from "./order-schema.ts";
import {
  type LaunchCashReservationRow,
  type OrderPacketRow,
} from "./order-store.ts";
import {
  quoteView,
  readCurrentSettings,
  specView,
  type QuoteRow,
  type SpecRow,
} from "./quote-store.ts";
import { settingsSnapshotSchema } from "./settings-schema.ts";
import {currentOrderGoReady} from './order-validation.ts';
import {assessOrderRiskReview} from '@forge-ops/domain';

export type ApplyOrderApprovalResult =
  | { applied: true }
  | { applied: false; code: string };

function packetPayload(row: ApprovalRow): OrderPacketPayload | null {
  if (row.kind !== "order_decision") return null;
  if (exactPayloadHash(row.payload) !== row.payload_hash) return null;
  const parsed = orderPacketPayloadSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

async function stale(
  db: QueryConnection,
  packetId: string,
): Promise<ApplyOrderApprovalResult> {
  await db.query(
    "UPDATE order_packets SET state='stale' WHERE id=$1 AND state='pending_approval'",
    [packetId],
  );
  return { applied: false, code: "APPROVAL_STALE" };
}

function packetMatches(
  packet: OrderPacketRow,
  approval: ApprovalRow,
  payload: OrderPacketPayload,
): boolean {
  return (
    packet.id === payload.packetId &&
    packet.candidate_id === payload.candidateId &&
    packet.quote_id === payload.source.quote.id &&
    packet.spec_id === payload.source.spec.id &&
    packet.settings_version === payload.settings.version &&
    packet.decision === payload.decision &&
    packet.note === payload.note &&
    packet.approval_id === approval.id &&
    packet.payload_hash === approval.payload_hash &&
    exactPayloadHash(packet.payload) === approval.payload_hash
  );
}

export async function launchBudgetAllows(
  db: QueryConnection,
  newLimit: string,
): Promise<boolean> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.launch_cash'))");
  const result = await db.query<{ allowed: boolean }>(
    `SELECT coalesce(sum(reserved_usd) FILTER (WHERE state='active'),0) <= $1::numeric AS allowed
     FROM launch_cash_reservations`,
    [newLimit],
  );
  return result.rows[0]?.allowed === true;
}

async function cashReservationAllowed(
  db: QueryConnection,
  reservedUsd: string,
  limitUsd: string,
): Promise<boolean> {
  const result = await db.query<{ allowed: boolean }>(
    `SELECT coalesce(sum(reserved_usd) FILTER (WHERE state='active'),0)+$1::numeric <= $2::numeric AS allowed
     FROM launch_cash_reservations`,
    [reservedUsd, limitUsd],
  );
  return result.rows[0]?.allowed === true;
}

export async function applyOrderApproval(
  db: QueryConnection,
  row: ApprovalRow,
  userId: string,
): Promise<ApplyOrderApprovalResult> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.launch_cash'))");
  const payload = packetPayload(row);
  if (!payload) return { applied: false, code: "APPROVAL_STALE" };
  const packetResult = await db.query<OrderPacketRow>(
    `SELECT p.*,a.status AS approval_status
     FROM order_packets p LEFT JOIN approvals a ON a.id=p.approval_id
     WHERE p.id=$1 FOR UPDATE OF p`,
    [payload.packetId],
  );
  const packet = packetResult.rows[0];
  if (!packet || !packetMatches(packet, row, payload))
    return packet ? stale(db, packet.id) : { applied: false, code: "APPROVAL_STALE" };
  if (packet.state === "recorded") return { applied: true };
  if (packet.state !== "pending_approval") return { applied: false, code: "APPROVAL_STALE" };

  if (payload.decision === "hold" || payload.decision === "reject") {
    const stage = payload.decision === "hold" ? "economics_review" : "decision_recorded";
    const blockedReason = payload.decision === "hold" ? "evidence" : null;
    await db.query(
      "UPDATE candidates SET stage=$2,blocked_reason=$3,quote_count_at_hold=CASE WHEN $2='economics_review' THEN (SELECT count(*)::integer FROM supplier_quotes WHERE candidate_id=$1) ELSE NULL END,last_progress_at=now() WHERE id=$1",
      [payload.candidateId, stage, blockedReason],
    );
    await db.query("UPDATE order_packets SET state='recorded' WHERE id=$1", [
      packet.id,
    ]);
    await db.query(
      "INSERT INTO audit_events(actor,action,target,approval_hash) VALUES($1,'order_decision_recorded',$2,$3)",
      [userId, packet.id, row.payload_hash],
    );
    return { applied: true };
  }

  const current = await readCurrentSettings(db);
  if (!settingsSnapshotSchema.safeParse(current.snapshot).success)
    return { applied: false, code: "SETTINGS_REQUIRED" };
  if (
    current.version !== payload.settings.version ||
    exactPayloadHash(current.snapshot) !== exactPayloadHash(payload.settings.snapshot)
  )
    return stale(db, packet.id);
  const candidate = await db.query<{ id: string }>(
    "SELECT id FROM candidates WHERE id=$1 FOR UPDATE",
    [payload.candidateId],
  );
  if (!candidate.rows[0]) return stale(db, packet.id);
  const quoteResult = await db.query<QuoteRow>(
    `SELECT q.*,q.valid_until::text AS valid_until
     FROM supplier_quotes q WHERE q.id=$1 AND q.candidate_id=$2 FOR UPDATE`,
    [payload.source.quote.id, payload.candidateId],
  );
  const quoteRow = quoteResult.rows[0];
  if (!quoteRow) return stale(db, packet.id);
  const specResult = await db.query<SpecRow>(
    "SELECT * FROM spec_revisions WHERE id=$1 AND candidate_id=$2 FOR UPDATE",
    [payload.source.spec.id, payload.candidateId],
  );
  const specRow = specResult.rows[0];
  if (!specRow) return stale(db, packet.id);
  const quote = quoteView(quoteRow, current);
  const spec = specView(specRow);
  const source = orderSourceSnapshot(spec, quote);
  if (
    quote.specId !== spec.id ||
    exactPayloadHash(source) !== payload.sourceHash ||
    exactPayloadHash(payload.source) !== payload.sourceHash ||
    exactPayloadHash(quote.assessment) !== exactPayloadHash(payload.assessment) ||
    quote.assessment.outcome !== "GO"
  )
    return stale(db, packet.id);
  if (!await currentOrderGoReady(db,payload.candidateId,current)) return stale(db, packet.id);
  if (assessOrderRiskReview(payload.riskReview) !== "GO") return stale(db, packet.id);
  const cash = reserveCash(quote);
  if (
    !cash ||
    payload.reservation === null ||
    exactPayloadHash(cash) !== exactPayloadHash(payload.reservation)
  )
    return stale(db, packet.id);
  const existing = await db.query<LaunchCashReservationRow>(
    "SELECT * FROM launch_cash_reservations WHERE candidate_id=$1 AND state='active' FOR UPDATE",
    [payload.candidateId],
  );
  const prior = existing.rows[0];
  if (prior) {
    if (prior.order_packet_id === packet.id && prior.state === "active")
      return { applied: true };
    return stale(db, packet.id);
  }
  const allowed = await cashReservationAllowed(
    db,
    cash.reservedUsd,
    current.snapshot.launchBudgetUsd,
  );
  if (!allowed)
    return { applied: false, code: "INSUFFICIENT_LAUNCH_CASH" };
  await db.query(
    `INSERT INTO launch_cash_reservations(candidate_id,order_packet_id,approval_id,raw_usd,reserved_usd,state,created_by)
     VALUES($1,$2,$3,$4::numeric,$5::numeric,'active',$6)`,
    [
      payload.candidateId,
      packet.id,
      row.id,
      cash.rawUsd,
      cash.reservedUsd,
      userId,
    ],
  );
  await db.query(
    "UPDATE candidates SET stage='decision_recorded',blocked_reason=NULL,quote_count_at_hold=NULL,last_progress_at=now() WHERE id=$1",
    [payload.candidateId],
  );
  await db.query("UPDATE order_packets SET state='recorded' WHERE id=$1", [
    packet.id,
  ]);
  await db.query(
    "INSERT INTO audit_events(actor,action,target,approval_hash,meta) VALUES($1,'launch_cash_reserved',$2,$3,$4::jsonb)",
    [userId, packet.id, row.payload_hash, JSON.stringify({ reservedUsd: cash.reservedUsd })],
  );
  return { applied: true };
}
