import type { ContactApprovalPayload } from "@forge-ops/domain";
import { rfqView, type QueryConnection, type RfqRow } from "./rfq-state.ts";

export async function insertContactProposal(
  db: QueryConnection,
  payload: ContactApprovalPayload,
  hash: string,
) {
  const approval = (
    await db.query<{ id: string }>(
      "INSERT INTO approvals(kind,candidate_id,payload_hash,payload,status) VALUES('supplier_contact',$1,$2,$3::jsonb,'pending') RETURNING id",
      [payload.candidateId, hash, JSON.stringify(payload)],
    )
  ).rows[0];
  if (!approval) throw new Error("Approval request could not be saved");
  const saved = (
    await db.query<RfqRow>(
      "UPDATE rfq_drafts SET state='pending_approval',approval_id=$2 WHERE id=$1 RETURNING *",
      [payload.rfqId, approval.id],
    )
  ).rows[0];
  if (!saved) throw new Error("Draft approval link could not be saved");
  return { approvalId: approval.id, rfq: rfqView(saved) };
}
