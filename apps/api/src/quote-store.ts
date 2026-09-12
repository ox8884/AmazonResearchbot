import {
  readApprovedSettings,
  quoteRecordView,
  type SupplierQuoteRow,
  type Pool,
} from "@forge-ops/db";
import { type SpecRecord } from "@forge-ops/domain";
export type Connection = Pick<Pool, "query">;
export type SpecRow = {
  ai_task_id: string | null;
  id: string;
  candidate_id: string;
  revision: number;
  material: string;
  dimensions: string;
  packaging: string;
  requirements: string;
  requested_quantity: number;
  source: string;
  created_at: Date;
};
export type QuoteRow = SupplierQuoteRow;
export const readCurrentSettings = readApprovedSettings;
export function specView(row: SpecRow): SpecRecord {
  return {
    aiTaskId: row.ai_task_id ?? null,
    id: row.id,
    candidateId: row.candidate_id,
    revision: row.revision,
    material: row.material,
    dimensions: row.dimensions,
    packaging: row.packaging,
    requirements: row.requirements,
    requestedQuantity: row.requested_quantity,
    source: row.source,
    createdAt: row.created_at.toISOString(),
  };
}
export const quoteView = quoteRecordView;
