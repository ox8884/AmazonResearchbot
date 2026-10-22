import {parseArgs} from 'node:util';
import {createPool} from '../packages/db/src/index.ts';
import {readRuntimeAuthority,runtimeEnvironment,assertDatabaseAuthority,parseKey} from '../packages/security/src/index.ts';
import {loadBrowserSigningKey,publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueAlibabaTask} from '../apps/worker/src/alibaba-scheduler.ts';

async function recover():Promise<void>{
 const {values,positionals}=parseArgs({allowPositionals:true,options:{device:{type:'string'},action:{type:'string'},'not-sent-receipt':{type:'string'},'read-receipt':{type:'string'}}});
 const mode=positionals[0],uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(positionals.length!==1||(mode!=='read'&&mode!=='rearm')||!values.device||!uuid.test(values.device)||!values.action||!uuid.test(values.action))throw new Error('ALIBABA_RECOVERY_ARGUMENTS_INVALID');
 const notSentReceiptId=values['not-sent-receipt'],readReceiptId=values['read-receipt'];
 if(mode==='rearm'?(!notSentReceiptId||!uuid.test(notSentReceiptId)||!readReceiptId||!uuid.test(readReceiptId)):(notSentReceiptId!==undefined||readReceiptId!==undefined))throw new Error('ALIBABA_RECOVERY_ARGUMENTS_INVALID');
 const authority=await readRuntimeAuthority('worker',process.env),source=await runtimeEnvironment(authority,process.env);
 if(!source.ENCRYPTION_KEY)throw new Error('ALIBABA_RECOVERY_KEY_REQUIRED');
 const encryptionKey=parseKey(source.ENCRYPTION_KEY),privateKey=await loadBrowserSigningKey(source,authority.appEnv);
 if(!privateKey)throw new Error('ALIBABA_RECOVERY_SIGNING_REQUIRED');
 const pool=createPool(authority.databaseUrl);
 try{
  await assertDatabaseAuthority(pool,authority);
  const lease=await pool.connect();
  try{
   const owned=(await lease.query<{acquired:boolean}>("SELECT pg_try_advisory_lock(hashtext('forge_ops.worker_authority')) AS acquired")).rows[0]?.acquired;
   if(!owned)throw new Error('ALIBABA_RECOVERY_WORKER_RUNNING');
   const origin=source.WEB_ORIGIN??'http://localhost:5173',url=new URL(origin);
   const local=authority.appEnv==='development'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
   if((!local&&url.protocol!=='https:')||url.origin!==origin||url.username||url.password)throw new Error('ALIBABA_RECOVERY_ORIGIN_INVALID');
   const identity=await publishBrowserSigningIdentity(pool,privateKey);
   const action=(await pool.query<{conversation_id:string}>(`SELECT a.conversation_id FROM alibaba_actions a JOIN alibaba_conversations c ON c.id=a.conversation_id
    WHERE a.id=$1 AND a.kind='followup' AND a.state='blocked' AND a.reason='NEGOTIATION_CONTEXT_CHANGED'
     AND a.started_at IS NULL AND a.dispatch_task_id IS NULL AND a.sent_message_id IS NULL
     AND c.status='attention' AND c.reason='NEGOTIATION_CONTEXT_CHANGED'`,[values.action])).rows[0];
   if(!action)throw new Error('ALIBABA_RECOVERY_ACTION_NOT_ELIGIBLE');
   const result=await queueAlibabaTask(pool,{deviceId:values.device,conversationId:action.conversation_id,encryptionKey,
    ...(mode==='read'?{recoveryRead:true as const}:{actionId:values.action,recovery:{notSentReceiptId:notSentReceiptId!,readReceiptId:readReceiptId!}})},
    {origin,privateKey,fingerprint:identity.fingerprint});
   console.log(JSON.stringify({mode,actionId:values.action,deviceId:values.device,...result}));
   if(result.kind!=='queued')process.exitCode=2;
  }finally{await lease.query("SELECT pg_advisory_unlock(hashtext('forge_ops.worker_authority'))");lease.release();}
 }finally{await pool.end();}
}
try{await recover();}catch(error){console.error(error instanceof Error&&/^ALIBABA_RECOVERY_[A-Z_]+$/.test(error.message)?error.message:'ALIBABA_RECOVERY_FAILED');process.exitCode=1;}
