import { randomUUID } from "node:crypto";
import type { QueryConnection, SourcingContext } from "@forge-ops/db";
import { compareCapturedSpec, type SupplierCapture } from "@forge-ops/domain";
import { encryptSecret, exactPayloadHash } from "@forge-ops/security";

export async function insertSupplierCapture(db: QueryConnection, input: {
 readonly capture: SupplierCapture; readonly encryptionKey: Buffer; readonly spec: SourcingContext;
 readonly sourcePageUrl?: string; readonly captureMethod?: "aside_search_result" | "aside_product_detail";
}) {
 const capture=input.capture, method=input.sourcePageUrl ? input.captureMethod ?? "aside_search_result" : "user_declared";
 const body=input.sourcePageUrl ? {...capture,sourcePageUrl:input.sourcePageUrl,captureMethod:method} : capture;
 const hash=exactPayloadHash(body);
 const existing=(await db.query<{id:string;supplier_id:string}>(
  "SELECT id,supplier_id FROM supplier_captures WHERE candidate_id=$1 AND spec_id=$2 AND input_version=$3 AND settings_version=$4 AND body_sha256=$5",
  [capture.candidateId,capture.specId,capture.inputVersion,capture.settingsVersion,hash],
 )).rows[0];
 if(existing)return {kind:"duplicate" as const,supplierId:existing.supplier_id,captureId:existing.id};
 const captureId=randomUUID(),supplierId=randomUUID();
 const match=method==="aside_search_result"?"unknown":compareCapturedSpec(capture,input.spec);
 const notes=method==="aside_search_result" ? "Search result observation; specification and contact address remain unverified."
  : match==="matches" ? (method==="aside_product_detail" ? "Supplier listing attributes exactly match the comparison target; this is not measured or certified evidence." : "Material, dimensions, packaging and requirements exactly match the captured page evidence.")
  : "One or more specification fields lack an exact source match; review is required.";
 const ciphertext=encryptSecret(Buffer.from(JSON.stringify(body)),input.encryptionKey,"supplier-capture:"+captureId);
 await db.query("INSERT INTO sourcing_suppliers(id,candidate_id,name,email,source,observed_at,match_status,match_notes,spec_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
  [supplierId,capture.candidateId,capture.companyName,method==="aside_search_result"?null:capture.email,capture.productUrl,capture.observedAt,match,notes,capture.specId]);
 await db.query("INSERT INTO supplier_captures(id,supplier_id,candidate_id,spec_id,input_version,settings_version,search_query,company_url,product_url,observed_at,body_sha256,body_ciphertext,capture_method,source_page_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
  [captureId,supplierId,capture.candidateId,capture.specId,capture.inputVersion,capture.settingsVersion,capture.searchQuery,capture.companyUrl,capture.productUrl,capture.observedAt,hash,ciphertext,method,input.sourcePageUrl??null]);
 return {kind:"stored" as const,supplierId,captureId};
}
