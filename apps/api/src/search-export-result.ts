import {randomUUID} from 'node:crypto';
import {attachSearchRunImport,type QueryConnection} from '@forge-ops/db';
import type {PgBoss} from 'pg-boss';
import {parseVerifiedSearchExport} from '@forge-ops/integrations/jungle-scout/search-export';
import {encryptSecret} from '@forge-ops/security';
import {importCsvWithinTransaction,ImportMappingConflict} from './import-store.ts';
import {lockSearchTaskSource} from './search-task-source.ts';
import type {SearchBrowserTaskRow} from './browser-task-store.ts';

export async function recordSearchExportResult(db:QueryConnection,task:SearchBrowserTaskRow,observation:unknown,bodyHash:string,boss:PgBoss,encryptionKey:Buffer){
 const source=await lockSearchTaskSource(db,task),now=Date.now();
 if(!source||task.state!=='delivered'||task.expires_at.getTime()<=now)return {kind:'stale' as const};
 const checked=await parseVerifiedSearchExport(observation,source.request);
 if(!checked)return {kind:'invalid' as const};
 const observed=Date.parse(checked.observation.observedAt);
 if(observed>now||observed<Date.parse(source.payload.issuedAt)||observed>Date.parse(source.payload.expiresAt))return {kind:'stale' as const};
 let imported;
 try{imported=await importCsvWithinTransaction(db,{filename:checked.observation.filename,bytes:checked.bytes,parsed:checked.parsed,source:{kind:'browser',observedAt:checked.observation.observedAt}},boss,encryptionKey);}
 catch(error){if(error instanceof ImportMappingConflict)return {kind:'conflict' as const};throw error;}
 await attachSearchRunImport(db,{id:source.run.id,import_id:null},imported.importId);
 await db.query("UPDATE saved_search_runs SET mode='browser',filter_verification='applied' WHERE id=$1",[source.run.id]);
 const receiptId=randomUUID();
 const ciphertext=encryptSecret(Buffer.from(JSON.stringify(checked.observation)),encryptionKey,'browser-task-result:'+receiptId);
 await db.query("INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids) VALUES($1,$2,$3,$4,'{}')",[receiptId,task.id,bodyHash,ciphertext]);
 await db.query("UPDATE browser_tasks SET state='completed',result_id=$2 WHERE id=$1",[task.id,receiptId]);
 await db.query("INSERT INTO audit_events(actor,action,target) SELECT owner_user_id,'search_export_recorded',$2 FROM bridge_devices WHERE id=$1",[task.device_id,source.run.id]);
 return {kind:'accepted' as const,receiptId,resultHash:bodyHash,captureIds:[],importId:imported.importId};
}
