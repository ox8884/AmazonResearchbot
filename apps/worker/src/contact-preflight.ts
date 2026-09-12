import { rfqSourceCurrent } from "@forge-ops/db";
import { contactEligibility, type Pool } from "@forge-ops/db";
import { contactApprovalSchema } from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import type { ContactTransport } from "@forge-ops/integrations/mail/transport";
export async function preflightContact(
  pool: Pool,
  id: string,
  transport: ContactTransport | null,
): Promise<{
  hash: string;
  authorization: Awaited<ReturnType<ContactTransport["authorize"]>>;
} | null> {
  if (!transport) return null;
  const found = await pool.query<{
    payload: unknown;
    payload_hash: string;
    approval_payload: unknown;
    approval_hash: string;
    approval_status: string;
    state: string;
    started_at: Date | null;
    blocked_reason: string | null;
    rfq_id: string;
    ai_task_id:string|null;
    candidate_id: string;
    rfq_state: string;
    approval_id: string;
    rfq_approval_id: string | null;
  }>(
    `SELECT a.payload,a.payload_hash,a.state,a.started_at,a.blocked_reason,a.rfq_id,a.approval_id,
      p.payload AS approval_payload,p.payload_hash AS approval_hash,p.status AS approval_status,
      r.candidate_id,r.ai_task_id,r.state AS rfq_state,r.approval_id AS rfq_approval_id
      FROM external_actions a JOIN approvals p ON p.id=a.approval_id JOIN rfq_drafts r ON r.id=a.rfq_id WHERE a.id=$1`,
    [id],
  );
  const row = found.rows[0];
  if (
    !row ||
    row.blocked_reason === "MAIL_SMTP_RECIPIENT_REJECTED" ||
    !["approved", "blocked"].includes(row.state) ||
    row.started_at !== null ||
    row.approval_status !== "approved" ||
    row.rfq_state !== "approved" ||
    row.approval_id !== row.rfq_approval_id
  )
    return null;
  const parsed = contactApprovalSchema.safeParse(row.payload);
  if (
    !parsed.success ||
    parsed.data.rfqId !== row.rfq_id ||
    parsed.data.candidateId !== row.candidate_id ||
    exactPayloadHash(row.payload) !== row.payload_hash ||
    row.approval_hash !== row.payload_hash ||
    exactPayloadHash(row.approval_payload) !== row.payload_hash
  )
    return null;
  if(!await rfqSourceCurrent(pool,{candidate_id:row.candidate_id,supplier_id:parsed.data.supplierId,ai_task_id:row.ai_task_id,spec_id:parsed.data.specId,quantity:parsed.data.quantity}))return null;
  const gate = await contactEligibility(pool, row.candidate_id, true);
  if (!gate.ready || gate.settingsVersion !== parsed.data.settingsVersion)
    return null;
  return {
    hash: row.payload_hash,
    authorization: await transport.authorize(parsed.data),
  };
}
