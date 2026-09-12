import { lockSourcingContext, type Pool } from "@forge-ops/db";
import { supplierCaptureSchema } from "@forge-ops/domain";
import { insertSupplierCapture } from "./capture-store.ts";
export { insertSupplierCapture } from "./capture-store.ts";

export async function persistSupplierCapture(pool: Pool, input: {
 readonly capture: unknown; readonly encryptionKey: Buffer;
}) {
 const parsed=supplierCaptureSchema.safeParse(input.capture);
 if(!parsed.success||Date.parse(parsed.data.observedAt)>Date.now())return {kind:"invalid" as const};
 const capture=parsed.data,db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const spec=await lockSourcingContext(db,capture.candidateId);
  if(!spec||spec.input_version!==capture.inputVersion||spec.settings_version!==capture.settingsVersion||spec.spec_id!==capture.specId){
   await db.query("COMMIT");return {kind:"stale" as const};
  }
  const result=await insertSupplierCapture(db,{capture,encryptionKey:input.encryptionKey,spec});
  if(result.kind==="stored")await db.query("UPDATE candidates SET blocked_reason=NULL,last_progress_at=now() WHERE id=$1 AND blocked_reason='web_session'",[capture.candidateId]);
  await db.query("COMMIT");return result;
 }catch(error){await db.query("ROLLBACK");throw error;}
 finally{db.release();}
}

export { alibabaCompanyKey, alibabaProductKey } from "./identity.ts";
