import {sealObservation,openObservation} from "./staged-observation.mjs";
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createBrowserTaskVerifier} from './task-verifier.mjs';

const applicationId=0x464b4f50;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function openBrowserTaskLedger(configuration) {
 const verifyTask=createBrowserTaskVerifier(configuration);
 if(typeof configuration.directory!=='string'||!configuration.directory.trim())throw new Error('INVALID_LEDGER_DIRECTORY');
 const directory=path.resolve(configuration.directory);
 mkdirSync(directory,{recursive:true,mode:0o700});
 const scope=createHash('sha256').update(configuration.origin+'|'+configuration.deviceId.toLowerCase()).digest('hex');
 const db=new DatabaseSync(path.join(directory,'tasks-'+scope+'.sqlite'));
 let initializing=false;
 try{
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  initializing=true;
  const marker=db.prepare('PRAGMA application_id').get().application_id;
  let version=db.prepare('PRAGMA user_version').get().user_version;
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if(marker===0&&version===0&&tables.length===0){
   db.exec("CREATE TABLE task_receipts(task_id TEXT PRIMARY KEY,task_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('started','completed')),receipt_id TEXT,created_at TEXT NOT NULL,completed_at TEXT,CHECK((state='started' AND receipt_id IS NULL AND completed_at IS NULL) OR (state='completed' AND receipt_id IS NOT NULL AND completed_at IS NOT NULL))) STRICT");
   db.exec('PRAGMA application_id='+applicationId+'; PRAGMA user_version=1');
   version=1;
  }else if(marker!==applicationId||![1,2,3].includes(version))throw new Error('UNRECOGNIZED_TASK_LEDGER');
  if(version===1){
   db.exec("ALTER TABLE task_receipts RENAME TO task_receipts_v1");
   db.exec("CREATE TABLE task_receipts(task_id TEXT PRIMARY KEY,task_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('started','completed','cancelled','conflict')),receipt_id TEXT,created_at TEXT NOT NULL,completed_at TEXT,body_hash TEXT,ciphertext TEXT,CHECK((state='completed')=(receipt_id IS NOT NULL)),CHECK((state!='started')=(completed_at IS NOT NULL)),CHECK(ciphertext IS NULL OR body_hash IS NOT NULL)) STRICT");
   db.exec("INSERT INTO task_receipts(task_id,task_hash,state,receipt_id,created_at,completed_at) SELECT task_id,task_hash,state,receipt_id,created_at,completed_at FROM task_receipts_v1");
   db.exec("DROP TABLE task_receipts_v1; PRAGMA user_version=2");
   version=2;
  }
  if(version<=2){
   db.exec("ALTER TABLE task_receipts RENAME TO task_receipts_v2");
   db.exec("CREATE TABLE task_receipts(task_id TEXT PRIMARY KEY,task_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('started','completed','cancelled','conflict')),receipt_id TEXT,created_at TEXT NOT NULL,completed_at TEXT,body_hash TEXT,ciphertext TEXT,next_attempt_at TEXT,retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0),CHECK((state='completed')=(receipt_id IS NOT NULL)),CHECK((state!='started')=(completed_at IS NOT NULL)),CHECK(ciphertext IS NULL OR body_hash IS NOT NULL),CHECK(next_attempt_at IS NULL OR state='started')) STRICT");
   db.exec("INSERT INTO task_receipts(task_id,task_hash,state,receipt_id,created_at,completed_at,body_hash,ciphertext) SELECT task_id,task_hash,state,receipt_id,created_at,completed_at,body_hash,ciphertext FROM task_receipts_v2");
   db.exec("DROP TABLE task_receipts_v2; PRAGMA user_version=3");
  }
  db.exec('COMMIT');initializing=false;
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
 }catch(error){try{if(initializing)db.exec('ROLLBACK');}finally{db.close();}throw error;}
 let closed=false;
 const rowFor=id=>db.prepare('SELECT task_id,task_hash,state,receipt_id,body_hash,ciphertext,next_attempt_at,retry_count FROM task_receipts WHERE task_id=?').get(id);
 const summary=row=>({kind:row.state!=='started'?row.state:row.ciphertext?'pending_submission':'pending_reconciliation',taskId:row.task_id,taskHash:row.task_hash,...(row.receipt_id?{receiptId:row.receipt_id}:{})});
 const transaction=run=>{
  db.exec('BEGIN IMMEDIATE');
  try{const result=run();db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}
 };
 return Object.freeze({
  claim(envelope){
   const task=verifyTask(envelope),taskId=task.id.toLowerCase(),taskHash=createHash('sha256').update(envelope.payload).digest('hex');
   return transaction(()=>{
    const row=rowFor(taskId);
    if(row){
     if(row.task_hash!==taskHash)throw new Error('TASK_PAYLOAD_CONFLICT');
     if(['cancelled','conflict'].includes(row.state)&&row.receipt_id===null&&row.body_hash===null){
      db.prepare("UPDATE task_receipts SET state='started',completed_at=NULL WHERE task_id=?").run(taskId);
      return {kind:'claimed',taskId,taskHash,task};
     }
     return summary(row);
    }
   db.prepare("INSERT INTO task_receipts(task_id,task_hash,state,created_at) VALUES(?,?,'started',?)").run(taskId,taskHash,new Date().toISOString());
    return {kind:'claimed',taskId,taskHash,task};
   });
  },
  complete(input){
   if(!input||!uuid.test(input.taskId)||!/^[a-f0-9]{64}$/.test(input.taskHash)||!uuid.test(input.receiptId))throw new Error('INVALID_TASK_RECEIPT');
   return transaction(()=>{
    const taskId=input.taskId.toLowerCase(),receiptId=input.receiptId.toLowerCase(),row=rowFor(taskId);
    if(!row||row.task_hash!==input.taskHash)throw new Error('TASK_NOT_CLAIMED');
    if(row.state==='completed'){
     if(row.receipt_id!==receiptId)throw new Error('TASK_RECEIPT_CONFLICT');
     return summary(row);
    }
    if(row.state!=='started')throw new Error('TASK_ALREADY_SETTLED');
    db.prepare("UPDATE task_receipts SET state='completed',receipt_id=?,completed_at=?,ciphertext=NULL,next_attempt_at=NULL,retry_count=0 WHERE task_id=?").run(receiptId,new Date().toISOString(),taskId);
    return {kind:'completed',taskId,taskHash:input.taskHash,receiptId};
   });
  },
  stage(input,credential){
   if(!input||!uuid.test(input.taskId)||!/^[a-f0-9]{64}$/.test(input.taskHash))throw new Error('INVALID_TASK_STAGE');
   const taskId=input.taskId.toLowerCase();
   const sealed=sealObservation(input.observation,credential,'browser-stage:'+scope+':'+taskId+':'+input.taskHash);
   return transaction(()=>{
    const row=rowFor(taskId);
    if(!row||row.task_hash!==input.taskHash||row.state!=='started')throw new Error('TASK_NOT_PENDING');
    if(row.body_hash&&row.body_hash!==sealed.bodyHash)throw new Error('STAGED_OBSERVATION_CONFLICT');
    if(!row.ciphertext)db.prepare('UPDATE task_receipts SET body_hash=?,ciphertext=?,next_attempt_at=NULL,retry_count=0 WHERE task_id=?').run(sealed.bodyHash,sealed.ciphertext,taskId);
    return {taskId,taskHash:input.taskHash,bodyHash:sealed.bodyHash};
   });
  },
  staged(taskId,credential){
   if(typeof taskId!=='string'||!uuid.test(taskId))throw new Error('INVALID_TASK_ID');
   const row=rowFor(taskId.toLowerCase());
   return row?.ciphertext?openObservation(row,credential,'browser-stage:'+scope+':'+row.task_id+':'+row.task_hash):null;
  },
  pending(){
   return db.prepare("SELECT task_id AS taskId,task_hash AS taskHash,body_hash AS bodyHash FROM task_receipts WHERE state='started' AND body_hash IS NOT NULL ORDER BY created_at,task_id").all();
  },
  retryable(now=new Date()){
   return db.prepare("SELECT task_id AS taskId,task_hash AS taskHash FROM task_receipts WHERE state='started' AND body_hash IS NULL AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,task_id").all(now.toISOString());
  },
  retryWaiting(now=new Date()){
   return db.prepare("SELECT task_id AS taskId,task_hash AS taskHash,next_attempt_at AS nextAttemptAt,retry_count AS retryCount FROM task_receipts WHERE state='started' AND body_hash IS NULL AND next_attempt_at>? ORDER BY next_attempt_at,task_id LIMIT 1").get(now.toISOString()) ?? null;
  },
  retry(input,now=new Date()){
   if(!input||!uuid.test(input.taskId)||!/^[a-f0-9]{64}$/.test(input.taskHash))throw new Error('INVALID_TASK_RETRY');
   return transaction(()=>{
    const taskId=input.taskId.toLowerCase(),row=rowFor(taskId);
    if(!row||row.task_hash!==input.taskHash||row.state!=='started'||row.body_hash!==null)throw new Error('TASK_NOT_RETRYABLE');
    if(row.next_attempt_at!==null&&Date.parse(row.next_attempt_at)>now.getTime())throw new Error('TASK_RETRY_BACKOFF');
    db.prepare('DELETE FROM task_receipts WHERE task_id=?').run(taskId);
    return {taskId,taskHash:input.taskHash,retryCount:row.retry_count};
   });
  },
  defer(input,now=new Date()){
   if(!input||!uuid.test(input.taskId)||!/^[a-f0-9]{64}$/.test(input.taskHash))throw new Error('INVALID_TASK_RETRY');
   return transaction(()=>{
    const taskId=input.taskId.toLowerCase(),row=rowFor(taskId);
    if(!row||row.task_hash!==input.taskHash||row.state!=='started'||row.body_hash!==null)throw new Error('TASK_NOT_RETRYABLE');
    const retryCount=row.retry_count+1;
    const delays=[30000,120000,300000];
    const delay=delays[Math.min(retryCount-1,delays.length-1)];
    const nextAttemptAt=new Date(now.getTime()+delay).toISOString();
    db.prepare('UPDATE task_receipts SET next_attempt_at=?,retry_count=? WHERE task_id=?').run(nextAttemptAt,retryCount,taskId);
    return {taskId,taskHash:input.taskHash,nextAttemptAt,retryCount};
   });
  },
  settle(input){
   if(!input||!uuid.test(input.taskId)||!/^[a-f0-9]{64}$/.test(input.taskHash)||!['cancelled','conflict'].includes(input.state))throw new Error('INVALID_TASK_SETTLEMENT');
   return transaction(()=>{
    const row=rowFor(input.taskId.toLowerCase());
    if(!row||row.task_hash!==input.taskHash)throw new Error('TASK_NOT_CLAIMED');
    if(row.state!==input.state&&row.state!=='started')throw new Error('TASK_ALREADY_SETTLED');
    if(row.state==='started')db.prepare('UPDATE task_receipts SET state=?,completed_at=? WHERE task_id=?').run(input.state,new Date().toISOString(),row.task_id);
    return {state:input.state,taskId:row.task_id};
   });
  },
  inspect(taskId){
   if(typeof taskId!=='string'||!uuid.test(taskId))throw new Error('INVALID_TASK_ID');
   const row=rowFor(taskId.toLowerCase());
   return row?{state:row.state,taskId:row.task_id,taskHash:row.task_hash,receiptId:row.receipt_id}:null;
  },
  close(){if(!closed){db.close();closed=true;}},
 });
}
