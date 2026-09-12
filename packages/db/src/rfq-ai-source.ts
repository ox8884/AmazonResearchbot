import {
  aiBusinessInputSchema,
  parseAiBusinessOutput,
  rfqWithAiWording,
} from "@forge-ops/domain";
import type { QueryConnection, RfqRow } from "./rfq-state.ts";
export async function currentAiRfq(
  db: QueryConnection,
  candidateId: string,
  specId: string,
  quantity: number,
) {
  const rows = await db.query<{
    id: string;
    input_payload: unknown;
    result_payload: unknown;
    keyword_display: string;
    material: string;
    dimensions: string;
    packaging: string;
    requirements: string;
    requested_quantity: number;
  }>(
    `SELECT t.id,t.input_payload,o.result_payload,c.keyword_display,s.material,s.dimensions,s.packaging,s.requirements,s.requested_quantity
 FROM ai_business_tasks t JOIN candidates c ON c.id=t.candidate_id JOIN ai_execution_operations o ON o.id=t.id JOIN spec_revisions s ON s.id=t.spec_id
 WHERE t.candidate_id=$1 AND t.spec_id=$2 AND t.role='rfq_draft' AND t.state='succeeded' AND o.state='succeeded'
 AND t.input_version=c.input_version AND t.settings_version=(SELECT max(version) FROM settings_versions)
 AND t.spec_id=(SELECT id FROM spec_revisions WHERE candidate_id=c.id ORDER BY revision DESC LIMIT 1)
 ORDER BY t.created_at DESC LIMIT 1`,
    [candidateId, specId],
  );
  const row = rows.rows[0];
  if (!row || row.requested_quantity !== quantity) return null;
  const input = aiBusinessInputSchema.safeParse(row.input_payload);
  if (!input.success || input.data.spec?.requestedQuantity !== quantity)
    return null;
  const output = parseAiBusinessOutput(row.result_payload, input.data);
  if (output?.role !== "rfq_draft") return null;
  return {
    aiTaskId: row.id,
    ...rfqWithAiWording(
      {
        product: row.keyword_display,
        material: row.material,
        dimensions: row.dimensions,
        packaging: row.packaging,
        requirements: row.requirements,
        quantity,
      },
      output.draftText,
    ),
  };
}
export async function rfqSourceCurrent(
  db: QueryConnection,
  rfq: Pick<
    RfqRow,
    "ai_task_id" | "candidate_id" | "spec_id" | "quantity" | "supplier_id"
  >,
): Promise<boolean> {
  const supplier = (
    await db.query<{ spec_id: string | null; latest_spec: string | null }>(
      `SELECT s.spec_id,(SELECT id FROM spec_revisions WHERE candidate_id=s.candidate_id ORDER BY revision DESC LIMIT 1) AS latest_spec FROM sourcing_suppliers s WHERE s.id=$1 AND s.candidate_id=$2`,
      [rfq.supplier_id, rfq.candidate_id],
    )
  ).rows[0];
  if (!supplier) return false;
  if (
    supplier.spec_id !== null &&
    (supplier.spec_id !== rfq.spec_id ||
      supplier.spec_id !== supplier.latest_spec)
  )
    return false;
  if (!rfq.ai_task_id) return true;
  const source = await currentAiRfq(
    db,
    rfq.candidate_id,
    rfq.spec_id,
    rfq.quantity,
  );
  return source?.aiTaskId === rfq.ai_task_id;
}
