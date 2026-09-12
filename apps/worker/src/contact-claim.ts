import { rfqSourceCurrent } from "@forge-ops/db";
import { preflightContact } from "./contact-preflight.ts";
import {
  contactEligibility,
  refreshContactStage,
  rfqView,
  type Pool,
  type RfqRow,
} from "@forge-ops/db";
import {
  contactApprovalSchema,
  contactPayload,
  type ContactApprovalPayload,
} from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import type { ContactTransport } from "@forge-ops/integrations/mail/transport";
type ActionRow = {
  id: string;
  rfq_id: string;
  approval_id: string;
  payload: unknown;
  payload_hash: string;
  state: string;
  started_at: Date | null;
  blocked_reason: string | null;
};
export type ContactClaim =
  | {
      kind: "ready";
      payload: ContactApprovalPayload;
      rfqId: string;
      candidateId: string;
    }
  | { kind: "skipped" };
export async function claimContact(
  pool: Pool,
  id: string,
  transport: ContactTransport | null,
): Promise<ContactClaim> {
  const prepared = await preflightContact(pool, id, transport);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('forge.settings'))",
    );
    const peek = await client.query<{ rfq_id: string; candidate_id: string }>(
      "SELECT a.rfq_id,r.candidate_id FROM external_actions a JOIN rfq_drafts r ON r.id=a.rfq_id WHERE a.id=$1",
      [id],
    );
    if (!peek.rows[0]) {
      await client.query("COMMIT");
      return { kind: "skipped" };
    }
    await client.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [
      peek.rows[0].candidate_id,
    ]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "rfq:" + peek.rows[0].rfq_id,
    ]);
    const result = await client.query<ActionRow>(
      "SELECT * FROM external_actions WHERE id=$1 FOR UPDATE",
      [id],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.blocked_reason === "MAIL_SMTP_RECIPIENT_REJECTED" ||
      !["approved", "blocked"].includes(row.state) ||
      row.started_at !== null
    ) {
      await client.query("COMMIT");
      return { kind: "skipped" };
    }
    const approval = await client.query<{
      status: string;
      payload: unknown;
      payload_hash: string;
    }>(
      "SELECT status,payload,payload_hash FROM approvals WHERE id=$1 FOR UPDATE",
      [row.approval_id],
    );
    const drafts = await client.query<RfqRow>(
      "SELECT * FROM rfq_drafts WHERE id=$1 FOR UPDATE",
      [row.rfq_id],
    );
    const rfq = drafts.rows[0],
      auth = approval.rows[0];
    const parsed = contactApprovalSchema.safeParse(row.payload);
    const gate = rfq
      ? await contactEligibility(client, rfq.candidate_id, true)
      : ({ ready: false } as const);
    const sourceCurrent=rfq?await rfqSourceCurrent(client,rfq):false;
    const valid =
      sourceCurrent &&
      parsed.success &&
      rfq &&
      auth?.status === "approved" &&
      rfq.state === "approved" &&
      rfq.approval_id === row.approval_id &&
      gate.ready &&
      gate.settingsVersion === parsed.data.settingsVersion &&
      exactPayloadHash(row.payload) === row.payload_hash &&
      auth.payload_hash === row.payload_hash &&
      exactPayloadHash(auth.payload) === row.payload_hash &&
      exactPayloadHash(contactPayload(rfqView(rfq), gate.settingsVersion)) ===
        row.payload_hash;
    if (!valid) {
      await client.query(
        "UPDATE external_actions SET state='cancelled',blocked_reason='APPROVAL_STALE',finished_at=now(),last_checked_at=now() WHERE id=$1",
        [id],
      );
      await client.query(
        "UPDATE rfq_drafts SET state='stale' WHERE id=$1 AND approval_id=$2 AND state='approved'",
        [row.rfq_id, row.approval_id],
      );
      await client.query(
        "UPDATE approvals SET status='stale' WHERE id=$1 AND status='approved'",
        [row.approval_id],
      );
      if (rfq) {
        await refreshContactStage(client, rfq.candidate_id);
        if (
          !gate.ready &&
          "reason" in gate &&
          gate.reason === "VALIDATION_REQUIRED"
        )
          await client.query(
            "UPDATE candidates SET blocked_reason='evidence' WHERE id=$1 AND stage IN ('sourcing','rfq_draft','awaiting_contact_approval','sending_rfq','awaiting_quote')",
            [rfq.candidate_id],
          );
      }
      await client.query("COMMIT");
      return { kind: "skipped" };
    }
    if (transport && (!prepared || prepared.hash !== row.payload_hash)) {
      await client.query("COMMIT");
      return { kind: "skipped" };
    }
    const authorization = prepared?.authorization ?? {
      allowed: false,
      reason: "MAIL_NOT_CONFIGURED",
    };
    if (!authorization.allowed) {
      await client.query(
        "UPDATE external_actions SET state='blocked',blocked_reason=$2,last_checked_at=now() WHERE id=$1",
        [id, authorization.reason],
      );
      await client.query(
        "UPDATE candidates SET blocked_reason='credential' WHERE id=$1 AND stage='sending_rfq'",
        [rfq.candidate_id],
      );
      await client.query("COMMIT");
      return { kind: "skipped" };
    }
    await client.query(
      "UPDATE external_actions SET state='dispatching',transport=$2,blocked_reason=NULL,started_at=now(),last_checked_at=now() WHERE id=$1",
      [id, transport?.name ?? "disabled"],
    );
    await client.query("UPDATE rfq_drafts SET state='sending' WHERE id=$1", [
      rfq.id,
    ]);
    await client.query(
      "UPDATE candidates SET blocked_reason=NULL WHERE id=$1 AND stage='sending_rfq' AND blocked_reason='credential'",
      [rfq.candidate_id],
    );
    await client.query("COMMIT");
    return {
      kind: "ready",
      payload: parsed.data,
      rfqId: rfq.id,
      candidateId: rfq.candidate_id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
