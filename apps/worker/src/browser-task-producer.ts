import { createHash, createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { lockActiveBridgeDevice, lockSourcingContext, lockPackageContext, lockMarketContext, readSupplierSearchSource, type Pool } from "@forge-ops/db";
import type { BrowserReadTask } from "@forge-ops/domain";
import { alibabaCompanyKey, alibabaProductKey } from "@forge-ops/integrations/sourcing/capture";
import { signBrowserTask } from "./browser-task-signer.ts";

type Signing = { readonly origin: string; readonly privateKey: KeyObject };
type Target = { readonly deviceId: string; readonly candidateId: string } & (
  { readonly kind: "supplier_search" | "amazon_package" | "amazon_search" } | { readonly kind: "supplier_detail"; readonly sourceCaptureId: string }
);
async function queueBrowserRead(pool: Pool, target: Target, signing: Signing) {
  const fingerprint = createHash("sha256").update(createPublicKey(signing.privateKey).export({ format: "der", type: "spki" })).digest("hex");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const device = await lockActiveBridgeDevice(db, target.deviceId);
    const source = device ? target.kind==='amazon_search'?await lockMarketContext(db,target.candidateId):target.kind === 'amazon_package' ? await lockPackageContext(db,target.candidateId) : await lockSourcingContext(db, target.candidateId) : null;
    if (!device || !source) { await db.query("COMMIT"); return { kind: "not_ready" as const }; }
    const captured = target.kind === "supplier_detail" && source.spec_id !== null ? await readSupplierSearchSource(db, target.sourceCaptureId, source) : null;
    if (target.kind === "supplier_detail" && (!captured || !alibabaCompanyKey(captured.company_url) || !alibabaProductKey(captured.product_url))) {
      await db.query("COMMIT"); return { kind: "not_ready" as const };
    }
    const ready = await db.query("SELECT d.id FROM bridge_devices d JOIN browser_signing_identity k ON k.fingerprint=d.reported_key_fingerprint WHERE d.id=$1 AND d.reported_connected=true AND d.reported_at>clock_timestamp()-interval '90 seconds' AND d.reported_key_fingerprint=$2 AND $3=ANY(d.reported_tasks)", [device.id, fingerprint, target.kind]);
    if (!ready.rowCount) { await db.query("COMMIT"); return { kind: "not_ready" as const }; }
    await db.query("UPDATE browser_tasks SET state='cancelled' WHERE device_id=$1 AND state IN ('queued','delivered') AND expires_at<=clock_timestamp()", [device.id]);
    const prior = (await db.query<{ id: string }>("SELECT id FROM browser_tasks WHERE candidate_id=$1 AND spec_id IS NOT DISTINCT FROM $2::uuid AND input_version=$3 AND settings_version=$4 AND source_capture_id IS NOT DISTINCT FROM $5::uuid AND task_kind=$6 AND (state='completed' OR (state IN ('queued','delivered') AND expires_at>clock_timestamp()))",
      [source.id, source.spec_id, source.input_version, source.settings_version, captured?.id ?? null,target.kind])).rows[0];
    if (prior) { await db.query("COMMIT"); return { kind: "existing" as const, taskId: prior.id }; }
    const now = new Date(), id = randomUUID(), expiresAt = new Date(now.getTime() + 300000).toISOString();
    const scope = { candidateId: source.id, inputVersion: source.input_version, settingsVersion: source.settings_version };
    const request: BrowserReadTask["request"] = 'market_query' in source
      ? {kind:'amazon_search',...scope,query:source.market_query}
      : source.spec_id === null
      ? { kind: 'amazon_package', ...scope, asin: source.asin }
      : captured
        ? { kind: "supplier_detail", ...scope, specId: source.spec_id, sourceCaptureId: captured.id, companyName: captured.company_name, companyUrl: captured.company_url, productUrl: captured.product_url }
        : { kind: "supplier_search", ...scope, specId: source.spec_id, query: source.keyword_display };
    const envelope = signBrowserTask({ version: 1, id, issuerOrigin: signing.origin, deviceId: device.id, issuedAt: now.toISOString(), expiresAt, request }, signing.privateKey);
    const taskHash = createHash("sha256").update(envelope.payload).digest("hex");
    await db.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,source_capture_id,task_kind) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)",
      [id, device.id, source.id, source.spec_id, source.input_version, source.settings_version, JSON.stringify(envelope), taskHash, expiresAt, captured?.id ?? null,target.kind]);
    await db.query("COMMIT"); return { kind: "queued" as const, taskId: id };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
export function queueSupplierSearch(pool: Pool, target: { readonly deviceId: string; readonly candidateId: string }, signing: Signing) {
  return queueBrowserRead(pool, { ...target, kind: "supplier_search" }, signing);
}
export function queueSupplierDetail(pool: Pool, target: { readonly deviceId: string; readonly candidateId: string; readonly sourceCaptureId: string }, signing: Signing) {
  return queueBrowserRead(pool, { ...target, kind: "supplier_detail" }, signing);
}
export function queueAmazonPackage(pool: Pool, target: { readonly deviceId: string; readonly candidateId: string }, signing: Signing) {
  return queueBrowserRead(pool, { ...target, kind: 'amazon_package' }, signing);
}
export function queueAmazonSearch(pool:Pool,target:{readonly deviceId:string;readonly candidateId:string},signing:Signing){
 return queueBrowserRead(pool,{...target,kind:'amazon_search'},signing);
}
