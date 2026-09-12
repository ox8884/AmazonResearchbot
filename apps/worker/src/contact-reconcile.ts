import { refreshContactStage, type Pool } from "@forge-ops/db";
import { contactApprovalSchema } from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import type { ContactTransport } from "@forge-ops/integrations/mail/transport";
export async function reconcileContact(
  pool: Pool,
  id: string,
  transport: ContactTransport,
): Promise<boolean> {
  if (!transport.reconcile) return false;
  const rows = await pool.query<{
    payload: unknown;
    payload_hash: string;
    rfq_id: string;
    state: string;
    transport: string;
  }>(
    "SELECT payload,payload_hash,rfq_id,state,transport FROM external_actions WHERE id=$1",
    [id],
  );
  const row = rows.rows[0];
  if (
    !row ||
    row.state !== "outcome_unknown" ||
    row.transport !== transport.name
  )
    return false;
  const parsed = contactApprovalSchema.safeParse(row.payload);
  if (!parsed.success || exactPayloadHash(row.payload) !== row.payload_hash)
    return false;
  const receipt = await transport.reconcile(parsed.data, id);
  if (!receipt || receipt.kind !== "sent") return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [parsed.data.candidateId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "rfq:" + row.rfq_id,
    ]);
    const updated = await client.query(
      "UPDATE external_actions SET state='sent',receipt=$2,finished_at=now() WHERE id=$1 AND state='outcome_unknown' RETURNING id",
      [id, receipt.receipt],
    );
    if (!updated.rowCount) {
      await client.query("COMMIT");
      return false;
    }
    await client.query(
      "UPDATE rfq_drafts SET state='awaiting_quote' WHERE id=$1 AND state='outcome_unknown'",
      [row.rfq_id],
    );
    await refreshContactStage(client, parsed.data.candidateId);
    await client.query(
      "INSERT INTO audit_events(actor,action,target) VALUES('worker','contact_reconciled',$1)",
      [id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
