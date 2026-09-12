import { reconcileContact } from "./contact-reconcile.ts";
import { refreshContactStage, type Pool } from "@forge-ops/db";
import type {
  ContactTransport,
  MailReceipt,
} from "@forge-ops/integrations/mail/transport";
import { claimContact } from "./contact-claim.ts";
export async function dispatchContact(
  pool: Pool,
  id: string,
  transport: ContactTransport | null,
): Promise<"skipped" | "sent" | "unknown" | "blocked"> {
  const claim = await claimContact(pool, id, transport);
  if (claim.kind === "skipped" || !transport) return "skipped";
  let result: MailReceipt;
  try {
    result = await transport.send(claim.payload, id);
  } catch {
    result = { kind: "unknown", reason: "DELIVERY_OUTCOME_UNKNOWN" };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [
      claim.candidateId,
    ]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "rfq:" + claim.rfqId,
    ]);
    if (result.kind === "sent") {
      await client.query(
        "UPDATE external_actions SET state='sent',receipt=$2,finished_at=now() WHERE id=$1 AND state IN ('dispatching','outcome_unknown')",
        [id, result.receipt],
      );
      await client.query(
        "UPDATE rfq_drafts SET state='awaiting_quote' WHERE id=$1 AND state IN ('sending','outcome_unknown')",
        [claim.rfqId],
      );
    } else if (result.kind === "not_sent") {
      const unsent = await client.query(
        "UPDATE external_actions SET state='blocked',blocked_reason=$2,started_at=NULL,finished_at=NULL,last_checked_at=now() WHERE id=$1 AND state='dispatching'",
        [id, result.reason],
      );
      if (unsent.rowCount !== 1)
        throw new Error("Contact result state changed");
      await client.query(
        "UPDATE rfq_drafts SET state='approved' WHERE id=$1 AND state='sending'",
        [claim.rfqId],
      );
    } else {
      await client.query(
        "UPDATE external_actions SET state='outcome_unknown',blocked_reason=$2,finished_at=now() WHERE id=$1 AND state='dispatching'",
        [id, result.reason],
      );
      await client.query(
        "UPDATE rfq_drafts SET state='outcome_unknown' WHERE id=$1 AND state='sending'",
        [claim.rfqId],
      );
    }
    await refreshContactStage(client, claim.candidateId);
    await client.query(
      "INSERT INTO audit_events(actor,action,target) VALUES('worker',$1,$2)",
      [
        result.kind === "sent"
          ? "contact_sent"
          : result.kind === "not_sent"
            ? "contact_not_sent"
            : "contact_outcome_unknown",
        id,
      ],
    );
    await client.query("COMMIT");
    return result.kind === "sent"
      ? "sent"
      : result.kind === "not_sent"
        ? "blocked"
        : "unknown";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function drainContacts(
  pool: Pool,
  transport: ContactTransport | null,
): Promise<void> {
  const actions = await pool.query<{ id: string }>(
    `SELECT id FROM external_actions WHERE started_at IS NULL AND
      (state='approved' OR (state='blocked' AND $1::boolean
        AND blocked_reason IS DISTINCT FROM 'MAIL_SMTP_RECIPIENT_REJECTED'
        AND (last_checked_at IS NULL OR last_checked_at<now()-interval '60 seconds')))
      ORDER BY last_checked_at NULLS FIRST,created_at LIMIT 4`,
    [transport !== null],
  );
  for (const action of actions.rows)
    await dispatchContact(pool, action.id, transport);
  if (transport?.reconcile) {
    const uncertain = await pool.query<{ id: string }>(
      "SELECT id FROM external_actions WHERE state='outcome_unknown' AND transport=$1 AND (last_checked_at IS NULL OR last_checked_at<now()-interval '60 seconds') ORDER BY last_checked_at NULLS FIRST,created_at LIMIT 4",
      [transport.name],
    );
    for (const action of uncertain.rows) {
      await pool.query(
        "UPDATE external_actions SET last_checked_at=now() WHERE id=$1",
        [action.id],
      );
      await reconcileContact(pool, action.id, transport);
    }
  }
}
export async function recoverContactOutcomes(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query<{
      id: string;
      rfq_id: string;
      candidate_id: string;
    }>(
      "SELECT a.id,a.rfq_id,r.candidate_id FROM external_actions a JOIN rfq_drafts r ON r.id=a.rfq_id WHERE a.state='dispatching' ORDER BY r.candidate_id,r.id,a.id",
    );
    let recovered = 0;
    for (const row of rows.rows) {
      await client.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [
        row.candidate_id,
      ]);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["rfq:" + row.rfq_id],
      );
      const changed = await client.query(
        "UPDATE external_actions SET state='outcome_unknown',blocked_reason='DELIVERY_PERSISTENCE_UNCONFIRMED',finished_at=now(),last_checked_at=NULL WHERE id=$1 AND state='dispatching' RETURNING id",
        [row.id],
      );
      if (!changed.rowCount) continue;
      await client.query(
        "UPDATE rfq_drafts SET state='outcome_unknown' WHERE id=$1 AND state='sending'",
        [row.rfq_id],
      );
      await refreshContactStage(client, row.candidate_id);
      recovered += 1;
    }
    await client.query("COMMIT");
    return recovered;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
