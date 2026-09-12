import type { Pool } from "@forge-ops/db";
import type {
  MailTransport,
  MailReceipt,
} from "@forge-ops/integrations/mail/transport";
import { exactPayloadHash } from "@forge-ops/security";
import {
  currentSummaryEnvelope,
  deliveryEnvelope,
  type SummaryDeliveryRow,
} from "./summary-delivery-store.ts";
export { prepareSummaryDelivery } from "./summary-delivery-store.ts";

export async function dispatchSummaryDelivery(
  pool: Pool,
  id: string,
  transport: MailTransport | null,
): Promise<"sent" | "unknown" | "blocked" | "skipped"> {
  if (!transport) return "skipped";
  const before = (
    await pool.query<SummaryDeliveryRow>(
      "SELECT * FROM summary_deliveries WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (
    !before ||
    !["pending", "blocked"].includes(before.state) ||
    before.retry_at > new Date()
  )
    return "skipped";
  const expected = await currentSummaryEnvelope(pool, before.summary_id);
  let authorization: { allowed: true } | { allowed: false; reason: string } = {
    allowed: false,
    reason: "SUMMARY_SOURCE_CHANGED",
  };
  if (expected && exactPayloadHash(expected) === before.payload_hash) {
    try {
      authorization = await transport.authorize(expected);
    } catch {
      authorization = { allowed: false, reason: "MAIL_PRECHECK_FAILED" };
    }
  }
  const db = await pool.connect();
  let claimed: SummaryDeliveryRow | null = null;
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const row = (
      await db.query<SummaryDeliveryRow>(
        "SELECT * FROM summary_deliveries WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (
      !row ||
      !["pending", "blocked"].includes(row.state) ||
      row.retry_at > new Date()
    ) {
      await db.query("COMMIT");
      return "skipped";
    }
    const current = await currentSummaryEnvelope(db, row.summary_id);
    if (
      !current ||
      exactPayloadHash(current) !== row.payload_hash ||
      exactPayloadHash(deliveryEnvelope(row)) !== row.payload_hash
    ) {
      await db.query(
        "UPDATE summary_deliveries SET state='cancelled',reason='SUMMARY_SOURCE_CHANGED',finished_at=now() WHERE id=$1",
        [id],
      );
      await db.query("COMMIT");
      return "skipped";
    }
    if (!authorization.allowed) {
      await db.query(
        "UPDATE summary_deliveries SET state='blocked',reason=$2,retry_at=now()+interval '5 minutes' WHERE id=$1",
        [id, authorization.reason],
      );
      await db.query("COMMIT");
      return "blocked";
    }
    await db.query(
      "UPDATE summary_deliveries SET state='dispatching',attempt_count=attempt_count+1,started_at=now(),reason=NULL WHERE id=$1",
      [id],
    );
    await db.query("COMMIT");
    claimed = row;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  if (!claimed) return "skipped";
  let result: MailReceipt;
  try {
    result = await transport.send(deliveryEnvelope(claimed), id);
  } catch {
    result = { kind: "unknown", reason: "SUMMARY_OUTCOME_UNKNOWN" };
  }
  switch (result.kind) {
    case "sent": {
      const saved=await pool.query("UPDATE summary_deliveries SET state='sent',receipt=$2,reason=NULL,finished_at=now() WHERE id=$1 AND state IN ('dispatching','unknown')",[id,result.receipt]);
      return saved.rowCount===1 ? "sent" : "skipped";
    }
    case "unknown": {
      const saved=await pool.query("UPDATE summary_deliveries SET state='unknown',reason=$2,finished_at=now() WHERE id=$1 AND state='dispatching'",[id,result.reason]);
      return saved.rowCount===1 ? "unknown" : "skipped";
    }
    case "not_sent": {
      const saved=result.reason === "MAIL_SMTP_RECIPIENT_REJECTED"
        ? await pool.query("UPDATE summary_deliveries SET state='cancelled',reason=$2,finished_at=now() WHERE id=$1 AND state='dispatching'",[id,result.reason])
        : await pool.query("UPDATE summary_deliveries SET state='blocked',reason=$2,started_at=NULL,retry_at=now()+interval '5 minutes' WHERE id=$1 AND state='dispatching'",[id,result.reason]);
      return saved.rowCount===1 ? "blocked" : "skipped";
    }
  }
}

export async function recoverSummaryDeliveries(pool: Pool): Promise<void> {
  await pool.query(
    "UPDATE summary_deliveries SET state='unknown',reason='SUMMARY_EXECUTOR_INTERRUPTED',finished_at=now() WHERE state='dispatching' AND started_at<now()-interval '5 minutes'",
  );
}

export async function reconcileSummaryDelivery(
  pool: Pool,
  id: string,
  transport: MailTransport | null,
): Promise<boolean> {
  if (!transport?.reconcile) return false;
  const row = (
    await pool.query<SummaryDeliveryRow>(
      "SELECT * FROM summary_deliveries WHERE id=$1 AND state='unknown'",
      [id],
    )
  ).rows[0];
  if (!row || exactPayloadHash(deliveryEnvelope(row)) !== row.payload_hash)
    return false;
  const result = await transport.reconcile(deliveryEnvelope(row), id);
  if (result?.kind !== "sent") return false;
  const updated = await pool.query(
    "UPDATE summary_deliveries SET state='sent',receipt=$2,reason=NULL,finished_at=now() WHERE id=$1 AND state='unknown'",
    [id, result.receipt],
  );
  return updated.rowCount === 1;
}
