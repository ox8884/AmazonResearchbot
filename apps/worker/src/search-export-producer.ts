import {createHash,createPublicKey,randomUUID,type KeyObject} from 'node:crypto';
import {lockActiveBridgeDevice,lockSearchExportContext,type Pool} from '@forge-ops/db';
import {signBrowserTask} from './browser-task-signer.ts';

type Signing={readonly origin:string;readonly privateKey:KeyObject;readonly fingerprint:string};
export async function queueSearchExport(pool:Pool,target:{deviceId:string;runId:string},signing:Signing){
 const fingerprint=createHash('sha256').update(createPublicKey(signing.privateKey).export({format:'der',type:'spki'})).digest('hex');
 if(fingerprint!==signing.fingerprint)throw new Error('SIGNING_IDENTITY_CHANGED');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const device=await lockActiveBridgeDevice(db,target.deviceId);
  const run=device?await lockSearchExportContext(db,target.runId,device.id):null;
  if(!device||!run){await db.query('COMMIT');return {kind:'not_ready' as const};}
  const ready=await db.query(`SELECT d.id FROM bridge_devices d JOIN browser_signing_identity k ON k.fingerprint=d.reported_key_fingerprint
   WHERE d.id=$1 AND d.reported_connected=true AND d.reported_at>clock_timestamp()-interval '90 seconds'
    AND d.reported_key_fingerprint=$2 AND 'saved_search_export'=ANY(d.reported_tasks)`,[device.id,fingerprint]);
  if(!ready.rowCount){await db.query('COMMIT');return {kind:'not_ready' as const};}
  await db.query("UPDATE browser_tasks SET state='cancelled' WHERE search_run_id=$1 AND state IN ('queued','delivered') AND expires_at<=clock_timestamp()",[run.id]);
  const prior=(await db.query<{id:string}>("SELECT id FROM browser_tasks WHERE search_run_id=$1 AND state IN ('queued','delivered','completed')",[run.id])).rows[0];
  if(prior){await db.query('COMMIT');return {kind:'existing' as const,taskId:prior.id};}
  const id=randomUUID(),now=new Date(),expiresAt=new Date(now.getTime()+300000).toISOString();
  const envelope=signBrowserTask({version:1,id,issuerOrigin:signing.origin,deviceId:device.id,issuedAt:now.toISOString(),expiresAt,
   request:{kind:'saved_search_export',searchRunId:run.id,searchId:run.snapshot.id,revision:run.snapshot.revision,marketplace:'us',category:'Kitchen & Dining',filters:run.snapshot.filters}},signing.privateKey);
  const taskHash=createHash('sha256').update(envelope.payload).digest('hex');
  await db.query("INSERT INTO browser_tasks(id,device_id,search_run_id,envelope,task_hash,expires_at,task_kind) VALUES($1,$2,$3,$4::jsonb,$5,$6,'saved_search_export')",[id,device.id,run.id,JSON.stringify(envelope),taskHash,expiresAt]);
  await db.query("UPDATE saved_search_runs SET mode='browser' WHERE id=$1",[run.id]);
  await db.query('COMMIT');return {kind:'queued' as const,taskId:id};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

export async function dispatchSearchExports(pool:Pool,signing:Signing){
 const targets=(await pool.query<{run_id:string;device_id:string}>(`
  SELECT DISTINCT ON(r.id) r.id AS run_id,d.id AS device_id FROM saved_search_runs r
  JOIN bridge_devices d ON d.owner_user_id=r.created_by JOIN "user" u ON u.id=d.owner_user_id
  WHERE r.state='awaiting_csv' AND d.revoked_at IS NULL AND u.two_factor_enabled=true AND d.reported_connected=true
    AND d.reported_at>clock_timestamp()-interval '90 seconds' AND d.reported_key_fingerprint=$1
    AND 'saved_search_export'=ANY(d.reported_tasks)
    AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.search_run_id=r.id AND
      (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
  ORDER BY r.id,d.reported_at DESC,d.id LIMIT 10`,[signing.fingerprint])).rows;
 let queued=0;
 for(const target of targets)if((await queueSearchExport(pool,{deviceId:target.device_id,runId:target.run_id},signing)).kind==='queued')queued++;
 return {queued,deviceReady:targets.length>0};
}
