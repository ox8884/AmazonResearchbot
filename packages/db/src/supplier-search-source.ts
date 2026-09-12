import type { QueryConnection } from "./rfq-state.ts";
import type { SourcingContext } from "./sourcing-context.ts";
export type SupplierSearchSource = {
  readonly id: string; readonly company_url: string; readonly product_url: string;
  readonly company_name: string; readonly search_query: string;
};
export async function readSupplierSearchSource(db: QueryConnection, captureId: string, source: SourcingContext): Promise<SupplierSearchSource | null> {
  const rows = await db.query<SupplierSearchSource>(`
    SELECT cap.id,cap.company_url,cap.product_url,cap.search_query,s.name AS company_name
    FROM supplier_captures cap JOIN sourcing_suppliers s ON s.id=cap.supplier_id
      AND s.candidate_id=cap.candidate_id AND s.spec_id=cap.spec_id
    WHERE cap.id=$1 AND cap.capture_method='aside_search_result' AND cap.candidate_id=$2
      AND cap.spec_id=$3 AND cap.input_version=$4 AND cap.settings_version=$5`,
    [captureId, source.id, source.spec_id, source.input_version, source.settings_version]);
  return rows.rows[0] ?? null;
}
