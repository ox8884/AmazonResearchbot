import type { Pool } from "./client.ts";
import type { RfqRecord, RfqState } from "@forge-ops/domain";
export type QueryConnection = Pick<Pool, "query">;
export type ContactGate =
  { ready: true; settingsVersion: number } | { ready: false; reason: string };
export async function contactEligibility(
  db: QueryConnection,
  candidateId: string,
  allowMailWait = false,
): Promise<ContactGate> {
  const result = await db.query<{
    stage: string;
    blocked_reason: string | null;
    version: number | null;
    validated: boolean;
  }>(
    `SELECT c.stage,c.blocked_reason,s.version,
    COALESCE((SELECT e.outcome='pass' AND NOT e.stale FROM evaluations e
      WHERE e.candidate_id=c.id AND e.kind='api_validation' AND e.settings_version=s.version
        AND e.payload->>'inputVersion'=c.input_version::text
      ORDER BY e.created_at DESC,e.id DESC LIMIT 1),false) AS validated
    FROM candidates c LEFT JOIN LATERAL (SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) s ON true WHERE c.id=$1`,
    [candidateId],
  );
  const row = result.rows[0];
  if (!row) return { ready: false, reason: "CANDIDATE_MISSING" };
  if (row.version === null || !row.validated)
    return { ready: false, reason: "VALIDATION_REQUIRED" };
  if (
    row.blocked_reason &&
    !(
      (allowMailWait && row.stage === "sending_rfq" && row.blocked_reason === "credential") ||
      (row.stage === "economics_review" && row.blocked_reason === "evidence")
    )
  )
    return { ready: false, reason: row.blocked_reason };
  if (
    ![
      "sourcing",
      "rfq_draft",
      "awaiting_contact_approval",
      "sending_rfq",
      "awaiting_quote",
      "economics_review",
      "awaiting_order_decision",
    ].includes(row.stage)
  )
    return { ready: false, reason: "STAGE_NOT_READY" };
  return { ready: true, settingsVersion: row.version };
}
export type RfqRow = {
  ai_task_id?: string | null;
  id: string;
  candidate_id: string;
  supplier_id: string;
  spec_id: string;
  quantity: number;
  recipient: string;
  subject: string;
  body: string;
  revision: number;
  state: RfqState;
  approval_id: string | null;
  created_at: Date;
  delivery_transport?: string | null;
  delivery_state?: string | null;
  delivery_reason?: string | null;
};
export function rfqView(row: RfqRow): RfqRecord {
  return {
    id: row.id,
    aiTaskId: row.ai_task_id ?? null,
    candidateId: row.candidate_id,
    supplierId: row.supplier_id,
    specId: row.spec_id,
    quantity: row.quantity,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    revision: row.revision,
    state: row.state,
    approvalId: row.approval_id,
    createdAt: row.created_at.toISOString(),
    deliveryTransport: row.delivery_transport ?? null,
    deliveryState: row.delivery_state ?? null,
    deliveryReason: row.delivery_reason ?? null,
  };
}
export async function refreshContactStage(
  db: QueryConnection,
  candidateId: string,
): Promise<void> {
  await db.query(
    `WITH counts AS (SELECT
    count(*) FILTER(WHERE state='pending_approval') AS pending,
    count(*) FILTER(WHERE state IN ('approved','sending')) AS sending,
    count(*) FILTER(WHERE state='outcome_unknown') AS uncertain,
    count(*) FILTER(WHERE state='awaiting_quote') AS sent,
    count(*) FILTER(WHERE state='draft') AS drafts,
    (SELECT count(*) FROM supplier_quotes WHERE candidate_id=$1) AS quotes
    FROM rfq_drafts WHERE candidate_id=$1)
    UPDATE candidates SET stage=CASE WHEN counts.uncertain>0 THEN 'sending_rfq' WHEN counts.pending>0 THEN 'awaiting_contact_approval' WHEN counts.sending>0 THEN 'sending_rfq' WHEN counts.quotes>0 AND quote_count_at_hold>=counts.quotes THEN 'economics_review' WHEN counts.quotes>0 THEN 'awaiting_order_decision' WHEN counts.sent>0 THEN 'awaiting_quote' WHEN counts.drafts>0 THEN 'rfq_draft' ELSE 'sourcing' END,
    blocked_reason=CASE WHEN counts.uncertain>0 THEN 'external_outcome_unknown' WHEN counts.pending=0 AND EXISTS(SELECT 1 FROM external_actions a JOIN rfq_drafts r ON r.id=a.rfq_id WHERE r.candidate_id=$1 AND r.approval_id=a.approval_id AND r.state='approved' AND a.state='blocked') THEN 'credential' WHEN counts.pending=0 AND counts.sending=0 AND counts.quotes>0 AND quote_count_at_hold>=counts.quotes THEN 'evidence' ELSE NULL END,last_progress_at=now()
    FROM counts WHERE id=$1 AND stage IN ('sourcing','rfq_draft','awaiting_contact_approval','sending_rfq','awaiting_quote','economics_review','awaiting_order_decision') AND (blocked_reason IS NULL OR blocked_reason='external_outcome_unknown' OR (stage='sending_rfq' AND blocked_reason='credential') OR (stage='economics_review' AND blocked_reason='evidence'))`,
    [candidateId],
  );
}
