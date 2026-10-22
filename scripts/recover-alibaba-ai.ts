import {parseArgs} from 'node:util';
import {createHash,createPublicKey} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPool} from '../packages/db/src/index.ts';
import {readRuntimeAuthority,runtimeEnvironment,assertDatabaseAuthority,parseKey} from '../packages/security/src/index.ts';
import {loadBrowserSigningKey} from '../apps/worker/src/browser-signing-key.ts';
import {ALIBABA_AI_FORMAT_FIX_SHA256,queueAlibabaTask} from '../apps/worker/src/alibaba-scheduler.ts';

async function recover():Promise<void>{
 const {values}=parseArgs({options:{device:{type:'string'},conversation:{type:'string'},inbound:{type:'string'},'failure-receipt':{type:'string'},fix:{type:'string'}}});
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!values.device||!uuid.test(values.device)||!values.conversation||!uuid.test(values.conversation)||!values.inbound||!uuid.test(values.inbound)||!values['failure-receipt']||!uuid.test(values['failure-receipt']))throw new Error('ALIBABA_AI_RECOVERY_ARGUMENTS_INVALID');
 if(values.fix!==ALIBABA_AI_FORMAT_FIX_SHA256||createHash('sha256').update((await readFile(new URL('../apps/browser-bridge/aside-ai.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n')).digest('hex')!==ALIBABA_AI_FORMAT_FIX_SHA256)throw new Error('ALIBABA_AI_RECOVERY_FIX_MISMATCH');
 const authority=await readRuntimeAuthority('worker',process.env),source=await runtimeEnvironment(authority,process.env);
 if(!source.ENCRYPTION_KEY)throw new Error('ALIBABA_AI_RECOVERY_KEY_REQUIRED');
 const encryptionKey=parseKey(source.ENCRYPTION_KEY),pool=createPool(authority.databaseUrl);
 try{
  await assertDatabaseAuthority(pool,authority);
  const privateKey=await loadBrowserSigningKey(source,authority.appEnv);
  if(!privateKey)throw new Error('ALIBABA_AI_RECOVERY_SIGNING_REQUIRED');
  const lease=await pool.connect();let owned=false;
  try{
   owned=(await lease.query<{acquired:boolean}>("SELECT pg_try_advisory_lock(hashtext('forge_ops.worker_authority')) AS acquired")).rows[0]?.acquired===true;
   if(!owned)throw new Error('ALIBABA_AI_RECOVERY_WORKER_RUNNING');
   const origin=source.WEB_ORIGIN??'http://localhost:5173',url=new URL(origin);
   const local=authority.appEnv==='development'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
   if((!local&&url.protocol!=='https:')||url.origin!==origin||url.username||url.password)throw new Error('ALIBABA_AI_RECOVERY_ORIGIN_INVALID');
   const fingerprint=createHash('sha256').update(createPublicKey(privateKey).export({format:'der',type:'spki'})).digest('hex');
   const identity=(await pool.query<{fingerprint:string}>('SELECT fingerprint FROM browser_signing_identity WHERE singleton=1')).rows[0];
   if(identity?.fingerprint!==fingerprint)throw new Error('ALIBABA_AI_RECOVERY_SIGNING_MISMATCH');
   const result=await queueAlibabaTask(pool,{deviceId:values.device,conversationId:values.conversation,encryptionKey,aiRecovery:{inboundMessageId:values.inbound,failureReceiptId:values['failure-receipt'],fixHash:values.fix}},{origin,privateKey,fingerprint});
   console.log(JSON.stringify({conversationId:values.conversation,inboundMessageId:values.inbound,failureReceiptId:values['failure-receipt'],fixHash:values.fix,...result}));
   if(result.kind!=='queued')process.exitCode=2;
  }finally{if(owned)await lease.query("SELECT pg_advisory_unlock(hashtext('forge_ops.worker_authority'))");lease.release();}
 }finally{encryptionKey.fill(0);await pool.end();}
}
try{await recover();}catch(error){console.error(error instanceof Error&&/^ALIBABA_AI_RECOVERY_[A-Z_]+$/.test(error.message)?error.message:'ALIBABA_AI_RECOVERY_FAILED');process.exitCode=1;}
