import { rfqSourceCurrent } from "@forge-ops/db";
import {
  contactEligibility,
  refreshContactStage,
  rfqView,
  type QueryConnection,
  type RfqRow,
} from "@forge-ops/db";
import { contactPayload } from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import { contactApprovalSchema } from "./rfq-schema.ts";
import type { ApprovalRow } from "./approval-types.ts";
export async function applyContactApproval(
  db: QueryConnection,
  row: ApprovalRow,
): Promise<boolean> {
  const parsed = contactApprovalSchema.safeParse(row.payload);
  if (!parsed.success) return false;
  const p = parsed.data;
  const result = await db.query<RfqRow>(
    "SELECT * FROM rfq_drafts WHERE id=$1 FOR UPDATE",
    [p.rfqId],
  );
  const rfq = result.rows[0];
  if (
    !rfq ||
    rfq.state !== "pending_approval" ||
    rfq.approval_id !== row.id ||
    rfq.candidate_id !== row.candidate_id
  )
    return false;
  if(!await rfqSourceCurrent(db,rfq))return false;
  const gate = await contactEligibility(db, rfq.candidate_id);
  if (!gate.ready || gate.settingsVersion !== p.settingsVersion) return false;
  if (
    exactPayloadHash(contactPayload(rfqView(rfq), gate.settingsVersion)) !==
    row.payload_hash
  )
    return false;
  await db.query(
    "INSERT INTO external_actions(approval_id,rfq_id,payload,payload_hash,state) VALUES($1,$2,$3::jsonb,$4,'approved') ON CONFLICT(approval_id) DO NOTHING",
    [row.id, rfq.id, JSON.stringify(p), row.payload_hash],
  );
  await db.query("UPDATE rfq_drafts SET state='approved' WHERE id=$1", [
    rfq.id,
  ]);
  await refreshContactStage(db, rfq.candidate_id);
  return true;
}
export async function rejectContactApproval(
  db: QueryConnection,
  row: ApprovalRow,
): Promise<boolean> {
  const drafts = await db.query<RfqRow>(
    "SELECT * FROM rfq_drafts WHERE approval_id=$1 FOR UPDATE",
    [row.id],
  );
  const rfq = drafts.rows[0];
  if (!rfq) return false;
  const result = await db.query<{ state: string }>(
    "SELECT state FROM external_actions WHERE approval_id=$1 FOR UPDATE",
    [row.id],
  );
  const action = result.rows[0];
  if (action && !["approved", "blocked"].includes(action.state)) return false;
  if (action)
    await db.query(
      "UPDATE external_actions SET state='cancelled',finished_at=now() WHERE approval_id=$1",
      [row.id],
    );
  await db.query(
    "UPDATE rfq_drafts SET state='rejected' WHERE id=$1 AND approval_id=$2",
    [rfq.id, row.id],
  );
  await refreshContactStage(db, rfq.candidate_id);
  return true;
}
