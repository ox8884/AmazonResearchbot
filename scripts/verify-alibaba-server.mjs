import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {signBrowserTask} from '../apps/worker/src/browser-task-signer.ts';
import {openAcceptance} from './support/acceptance.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {orderValidationFixture} from './support/order-market-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {queueSupplierSearch,queueAmazonSearch} from '../apps/worker/src/browser-task-producer.ts';
import {dispatchAlibabaWork,prepareAlibabaActions,queueAlibabaTask,recoverAlibabaStartedPresend} from '../apps/worker/src/alibaba-scheduler.ts';
import {decryptSecret,encryptSecret} from '../packages/security/src/secrets.ts';
import {contactEligibility} from '../packages/db/src/rfq-state.ts';
import {recoverAlibabaOutcomes} from '../packages/db/src/alibaba-state.ts';
import {alibabaStaleDraftIds} from '../packages/integrations/src/sourcing/capture.ts';
import {exactPayloadHash} from '../packages/security/src/approval-hash.ts';

async function verifyStartedPresend(disposition){
 const t=await openAcceptance({databaseKey:'alibaba-presend-'+disposition+'-'+randomUUID()}),key=Buffer.from(t.encryptionKeyHex,'hex'),keys=browserSigningFixture(),origin='http://localhost:5173';
 const q=async(sql,args)=>(await t.pool.query(sql,args)).rows[0],sha=s=>createHash('sha256').update(s).digest('hex');
 try{
  const settings=await q("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'presend-fixture',snapshot || '{\"supplierContactMode\":\"website\"}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1 RETURNING *");
  const identity=await publishBrowserSigningIdentity(t.pool,keys.privateKey),signing={origin,privateKey:keys.privateKey,fingerprint:identity.fingerprint};
  const pairing=await t.call('/api/bridge/pairings',{}),paired=await t.app.inject({method:'POST',url:'/api/bridge/pair',headers:{origin},payload:{pairingCode:pairing.body.pairingCode,name:'Presend isolated acceptance'}});assert.equal(paired.statusCode,201);const device=paired.json();
  const machine=async(url,payload)=>{const r=await t.app.inject({method:'POST',url,headers:{origin,authorization:'Bearer '+device.credential},payload});return {status:r.statusCode,body:r.json()};};
  assert.equal((await machine('/api/bridge/capabilities',{connected:true,supportedTasks:['supplier_search','supplier_thread','supplier_send'],keyFingerprint:identity.fingerprint})).status,200);
  const incidents=[
   {actionId:'3dde4cfc-154f-473d-9bf3-62b6e0b427e8',conversationId:'d3251458-1474-45d4-9537-1ab2b59c88a5',taskId:'7f38b710-c7b3-4827-8729-fdd8a599aebb',receiptId:'683cfdb9-19a7-4703-bd52-4643aa639352',startedAt:'2026-09-28T17:41:31.876671Z'},
   {actionId:'42173b4d-8386-411e-b084-f719a1b21739',conversationId:'b49b978b-8e1f-4f9d-af0c-7943af393db9',taskId:'0be50528-3f39-4b79-a178-bbaf3cd1b883',receiptId:'ddc796c3-1a0f-4239-85be-c9dab34fbb07',startedAt:'2026-09-28T17:43:13.466536Z'},
  ];
  const migration='0055_alibaba_started_presend_recovery.sql',sql=await readFile(new URL('../packages/db/sql/'+migration,import.meta.url),'utf8');
  assert.ok(await q('SELECT id FROM schema_migrations WHERE id=$1',[migration]));
  assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('alibaba_presend_audit','alibaba_presend_commit')")).n,2);
  console.log(JSON.stringify({presendMigration:{database:t.database,disposition,sha256:sha(sql),fresh:true}}));
  for(const incident of incidents){
   const c=await q("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING *",['Synthetic presend '+incident.actionId]);
   await t.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[c.id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot,'pass'))]);
   const source=await queueSupplierSearch(t.pool,{deviceId:device.id,candidateId:c.id},signing);assert.equal(source.kind,'queued');
   const sourceClaim=(await machine('/api/bridge/tasks/claim',{})).body;assert.equal(sourceClaim.taskId,source.taskId);
   const company='presend'+incident.actionId.replaceAll('-','')+'.en.alibaba.com',companyUrl='https://'+company+'/',productUrl='https://www.alibaba.com/product-detail/Synthetic_123.html';
   const sourceResult=await machine('/api/bridge/tasks/'+source.taskId+'/results',{taskHash:sourceClaim.taskHash,observation:{protocol:1,kind:'captured',scope:'first_results_page',sourcePageUrl:'https://www.alibaba.com/trade/search?SearchText='+encodeURIComponent(c.keyword_display),query:c.keyword_display,observedAt:new Date().toISOString(),snapshot:'Synthetic source',visibleCards:1,records:[{companyName:'Synthetic source',companyUrl:'https://source'+company+'/',productName:'Synthetic item',productUrl,pageText:'Synthetic source Synthetic item'}]}});assert.equal(sourceResult.status,201,JSON.stringify(sourceResult.body));
   const conversation=await q("INSERT INTO alibaba_conversations(id,candidate_id,spec_id,input_version,settings_version,company_key,company_name,company_url,product_url,source_receipt_id,account_id,provider_thread_id,status,reason) VALUES($1::uuid,$2,NULL,$3,$4,$5,'Synthetic presend',$6,$7,$8,'123456789',$1::uuid::text,'attention','SEND_NOT_CONFIRMED') RETURNING *",[incident.conversationId,c.id,c.input_version,settings.version,company,companyUrl,productUrl,sourceResult.body.receiptId]);
   const body='Please quote MOQ and delivery costs. This is a nonbinding request for quotation only. It is not an order. Do not start production or ship anything.\nInquiry reference: FK-'+incident.actionId;
   await t.pool.query("INSERT INTO alibaba_actions(id,conversation_id,candidate_id,spec_id,input_version,settings_version,kind,body_ciphertext,body_sha256) VALUES($1,$2,$3,NULL,$4,$5,'initial',$6,$7)",[incident.actionId,conversation.id,c.id,c.input_version,settings.version,encryptSecret(Buffer.from(body),key,'alibaba-action:'+incident.actionId),sha(body)]);
   const common={candidateId:c.id,specId:null,inputVersion:c.input_version,settingsVersion:settings.version,conversationId:conversation.id,companyName:conversation.company_name,companyUrl,productUrl,threadId:conversation.id,accountId:'123456789'},stamp=Date.parse(incident.startedAt);
   const original=signBrowserTask({version:1,id:incident.taskId,issuerOrigin:origin,deviceId:device.id,issuedAt:new Date(stamp-60000).toISOString(),expiresAt:new Date(stamp+240000).toISOString(),request:{kind:'supplier_send',...common,actionId:incident.actionId,body}},keys.privateKey);
   await t.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,action_id,state,delivered_at,first_delivered_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'supplier_send',$9,$10,'delivered',$11,$11)",[incident.taskId,device.id,c.id,c.input_version,settings.version,JSON.stringify(original),sha(original.payload),new Date(stamp+240000),conversation.id,incident.actionId,new Date(stamp-100)]);
   await t.pool.query("UPDATE alibaba_actions SET state='dispatching',started_at=$2::timestamptz,dispatch_task_id=$3 WHERE id=$1",[incident.actionId,incident.startedAt,incident.taskId]);
   await t.pool.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('fixture','alibaba_send_started',$1,$2)",[incident.actionId,JSON.stringify({taskId:incident.taskId})]);
   const observation={protocol:1,kind:'captured',scope:'alibaba_thread',conversationId:conversation.id,actionId:incident.actionId,companyName:conversation.company_name,companyUrl,productUrl,threadId:conversation.id,accountId:'123456789',sourcePageUrl:'https://message.alibaba.com/message/messenger.htm',observedAt:new Date(stamp-50).toISOString(),snapshot:'Synthetic original pre-click failure',messages:[],sendStatus:'not_sent',reason:'ALIBABA_SEND_UNAVAILABLE'};
   await t.pool.query("INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids,created_at) VALUES($1,$2,$3,$4,'{}',$5)",[incident.receiptId,incident.taskId,exactPayloadHash(observation),encryptSecret(Buffer.from(JSON.stringify(observation)),key,'browser-task-result:'+incident.receiptId),new Date(stamp+4000)]);
   await t.pool.query("UPDATE browser_tasks SET state='completed',result_id=$2 WHERE id=$1",[incident.taskId,incident.receiptId]);
   await t.pool.query("UPDATE alibaba_actions SET state='blocked',reason='SEND_NOT_CONFIRMED' WHERE id=$1",[incident.actionId]);
   const read=await queueAlibabaTask(t.pool,{deviceId:device.id,conversationId:conversation.id,encryptionKey:key,recoveryRead:true},signing);assert.equal(read.kind,'queued');
   const claimed=(await machine('/api/bridge/tasks/claim',{})).body;assert.equal(claimed.taskId,read.taskId);assert.equal(JSON.parse(Buffer.from(claimed.envelope.payload,'base64url').toString()).request.negotiation,undefined);
   const fresh={...observation,actionId:null,observedAt:new Date().toISOString(),snapshot:'Synthetic current signed read',sendStatus:'read',reason:null,messages:disposition==='reconciled'?[{id:'exact-'+incident.actionId,direction:'outbound',body,sentAt:new Date(stamp+2000).toISOString()}]:[]};
   const accepted=await machine('/api/bridge/tasks/'+read.taskId+'/results',{taskHash:claimed.taskHash,observation:fresh});assert.equal(accepted.status,201);
   const matched=await q('SELECT id FROM alibaba_messages WHERE conversation_id=$1 AND direction=\'outbound\'',[conversation.id]);
   const newTaskId=disposition==='requeue'?randomUUID():null,meta={incident:'alibaba-presend-20260928',authorizationReference:'synthetic-user-approval',conversationId:conversation.id,originalStartedAt:incident.startedAt,originalTaskId:incident.taskId,originalReceiptId:incident.receiptId,readReceiptId:accepted.body.receiptId,disposition,newTaskId,messageId:matched?.id??null,bodyHash:sha(body),originalTaskHash:sha(original.payload),originalReceiptHash:exactPayloadHash(observation),readTaskHash:claimed.taskHash,readReceiptHash:exactPayloadHash(fresh),originalClientHash:'c0b74ca596aa7a347ceb00ecf4956d30e8105952f29d7751a6a6c64b9b21f9d9',originalArchiveHash:'6f5a3ed8f863a657f4784d9a8a6c0ee1b29b260416327a3d5acbdd0ebd758954'};
   meta.readObservedAt=fresh.observedAt;
   const db=await t.pool.connect();try{
    await db.query('BEGIN');await db.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:operator','alibaba_started_presend_recovery',$1,$2::jsonb)",[incident.actionId,JSON.stringify(meta)]);
    await db.query(disposition==='requeue'?"UPDATE alibaba_actions SET state='pending',reason=NULL,started_at=NULL,dispatch_task_id=NULL WHERE id=$1":"UPDATE alibaba_actions SET state='sent',reason=NULL,sent_message_id=$2 WHERE id=$1",disposition==='requeue'?[incident.actionId]:[incident.actionId,matched.id]);
    console.log(JSON.stringify({presendGuardAdmission:disposition,actionId:incident.actionId,originalStartedAt:incident.startedAt,result:'PASS'}));
    await assert.rejects(db.query('COMMIT'),/coupled|requires/i,'Audit and action without the conversation/task coupling must not commit');
   }finally{await db.query('ROLLBACK');db.release();}
   const target={deviceId:device.id,conversationId:conversation.id,actionId:incident.actionId,readReceiptId:accepted.body.receiptId,authorizationReference:'synthetic-user-approval',encryptionKey:key};
   const snapshot=()=>q(`SELECT to_jsonb(a) AS action,to_jsonb(c) AS conversation,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM browser_tasks t WHERE t.conversation_id=c.id) AS tasks,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM audit_events e WHERE e.target=a.id::text) AS audits
    FROM alibaba_actions a JOIN alibaba_conversations c ON c.id=a.conversation_id WHERE a.id=$1`,[incident.actionId]);
   const before=await snapshot();
   const wrap=intercept=>({connect:async()=>{const db=await t.pool.connect();return {query:(sql,args)=>intercept(sql,args,()=>db.query(sql,args)),release:()=>db.release()};}});
   const recover=(overrides={},pool=t.pool)=>recoverAlibabaStartedPresend(pool,{...target,...overrides},signing);
   for(const overrides of [{actionId:randomUUID()},{conversationId:randomUUID()},{deviceId:randomUUID()},{readReceiptId:incident.receiptId},{readReceiptId:randomUUID()},{authorizationReference:''}]){assert.equal((await recover(overrides)).kind,'not_ready');assert.deepEqual(await snapshot(),before);}
   for(const defect of ['original-hash','original-signature','original-status','original-reason','original-body','original-action','original-scope','original-account','original-thread','original-time','read-hash','read-signature','read-device','read-source','read-negotiation','read-unavailable','read-reason','read-account','read-thread','read-future','read-missing-message','exact-start','unknown','other-reason']){
    const pool=wrap(async(sql,args,next)=>{
     const result=await next();return {...result,rows:result.rows.map(originalRow=>{
      const r=structuredClone(originalRow);
      if(sql.startsWith('SELECT a.*,to_char')){if(defect==='exact-start')r.original_started_at=incident.startedAt.replace(/\dZ$/,'0Z');if(defect==='unknown')r.state='outcome_unknown';if(defect==='other-reason')r.reason='OTHER';}
      if(!sql.includes('t.created_at AS task_created_at'))return r;
      const isOld=r.id===incident.receiptId,isRead=r.id===accepted.body.receiptId;
      if((isOld&&defect==='original-hash')||(isRead&&defect==='read-hash'))r.body_sha256='0'.repeat(64);
      if((isOld&&defect==='original-signature')||(isRead&&defect==='read-signature'))r.envelope.signature=Buffer.alloc(64).toString('base64url');
      if((isOld&&['original-body','original-action','original-scope'].includes(defect))||(isRead&&['read-device','read-source','read-negotiation'].includes(defect))){
       const task=JSON.parse(Buffer.from(r.envelope.payload,'base64url').toString());
       if(defect==='original-body')task.request.body+=' Changed';if(defect==='original-action')task.request.actionId=randomUUID();if(defect==='original-scope'||defect==='read-source')task.request.inputVersion++;if(defect==='read-device')task.deviceId=randomUUID();
       if(defect==='read-negotiation')task.request.negotiation={keyword:'Synthetic',specification:'Synthetic',round:1,lastOutbound:{providerMessageId:'synthetic',sentAt:fresh.observedAt,bodySha256:sha(body)}};
       r.envelope=signBrowserTask(task,keys.privateKey);r.task_hash=sha(r.envelope.payload);
      }
      if((isOld&&['original-status','original-reason','original-account','original-thread','original-time'].includes(defect))||(isRead&&['read-unavailable','read-reason','read-account','read-thread','read-future','read-missing-message'].includes(defect))){
       const o=JSON.parse(decryptSecret(r.body_ciphertext,key,'browser-task-result:'+r.id).toString());
       if(defect==='original-status')o.sendStatus='unknown';if(defect==='original-reason')o.reason='SEND_NOT_CONFIRMED';if(defect.endsWith('-account'))o.accountId='987654321';if(defect.endsWith('-thread'))o.threadId='wrong-thread';if(defect==='original-time')o.observedAt='2000-01-01T00:00:00.000Z';
       if(defect==='read-reason')o.reason='MESSAGE_IDENTITY_CONFLICT';if(defect==='read-unavailable')o.kind='unavailable';if(defect==='read-future')o.observedAt=new Date(Date.now()+100000).toISOString();if(defect==='read-missing-message')o.messages=[{id:'not-stored',direction:'inbound',body:'Synthetic not stored',sentAt:o.observedAt}];
       r.body_ciphertext=encryptSecret(Buffer.from(JSON.stringify(o)),key,'browser-task-result:'+r.id);r.body_sha256=exactPayloadHash(o);
      }return r;
     })};
    });
    assert.equal((await recover({},pool)).kind,'not_ready',defect);assert.deepEqual(await snapshot(),before,defect+' is mutation-free');
   }
   for(const point of ['audit','action','task']){
    if(point==='task'&&disposition==='reconciled')continue;
    const pool=wrap(async(sql,args,next)=>{const result=await next();if((point==='audit'&&sql.startsWith('INSERT INTO audit_events'))||(point==='action'&&sql.startsWith('UPDATE alibaba_actions'))||(point==='task'&&sql.startsWith('INSERT INTO browser_tasks')))throw new Error('presend injected '+point);return result;});
    await assert.rejects(recover({},pool),/presend injected/);assert.deepEqual(await snapshot(),before,'Fault at '+point+' rolls back all changes');
   }
   for(const defect of ['go','input','settings','spec','mode','stage','manual','binding','identity']){
    const extra={id:'current-'+defect,direction:defect==='binding'?'inbound':'outbound',body:defect==='binding'?'Please pay the deposit.':'Synthetic manual reply',sentAt:fresh.observedAt};
    const pool=wrap(async(sql,args,next)=>{
     const result=await next();
     if(sql.startsWith('SELECT c.id,c.stage'))return {...result,rows:result.rows.map(r=>({...r,...(defect==='input'?{input_version:r.input_version+1}:{}),...(defect==='settings'?{settings_version:r.settings_version+1}:{}),...(defect==='spec'?{spec_id:randomUUID()}:{}),...(defect==='mode'?{snapshot:{...r.snapshot,supplierContactMode:'email'}}:{}),...(defect==='stage'?{stage:'inbox'}:{})}))};
     if(defect==='go'&&sql.startsWith('SELECT * FROM evaluations'))return {...result,rows:[]};
     if(['manual','binding','identity'].includes(defect)){
      if(sql.startsWith('SELECT m.*,m.sent_at'))return {...result,rows:[...result.rows,{id:extra.id,conversation_id:conversation.id,provider_message_id:extra.id,direction:extra.direction,body_ciphertext:encryptSecret(Buffer.from(extra.body),key,'alibaba-message:'+extra.id),body_sha256:sha(extra.body),sent_at:new Date(extra.sentAt),receipt_id:accepted.body.receiptId,timely:true}]};
      if(sql.includes('t.created_at AS task_created_at'))return {...result,rows:result.rows.map(r=>{if(r.id!==accepted.body.receiptId)return r;const o={...fresh,messages:[...fresh.messages,{...extra,...(defect==='identity'?{body:'Altered identity'}:{})}]};return {...r,body_ciphertext:encryptSecret(Buffer.from(JSON.stringify(o)),key,'browser-task-result:'+r.id),body_sha256:exactPayloadHash(o)};})};
     }return result;
    });
    assert.equal((await recover({},pool)).kind,'not_ready',defect);assert.deepEqual(await snapshot(),before);
   }
   await assert.rejects(t.pool.query("UPDATE alibaba_actions SET started_at=NULL,dispatch_task_id=NULL WHERE id=$1",[incident.actionId]),/immutable/);
   for(const badMeta of [{...meta,originalStartedAt:incident.startedAt.replace(/\dZ$/,'0Z')},{...meta,originalReceiptId:incidents.find(x=>x!==incident).receiptId},{...meta,bodyHash:'0'.repeat(64)}])await assert.rejects(t.pool.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:operator','alibaba_started_presend_recovery',$1,$2)",[incident.actionId,JSON.stringify(badMeta)]),/evidence rejected/);
   await assert.rejects(t.pool.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:operator','alibaba_started_presend_recovery',$1,$2)",[incident.actionId,JSON.stringify(meta)]),/coupled|requires/,'An audit-only autocommit must fail');
   const agedRead=async age=>{
    const taskId=randomUUID(),receiptId=randomUUID(),observed=Date.now()-age,issued=observed-500;
    const task=signBrowserTask({version:1,id:taskId,issuerOrigin:origin,deviceId:device.id,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(issued+300000).toISOString(),request:{kind:'supplier_thread',...common}},keys.privateKey);
    const o={...fresh,observedAt:new Date(observed).toISOString()};
    await t.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,state,delivered_at,first_delivered_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'supplier_thread',$9,'delivered',$10,$10,$10)",[taskId,device.id,c.id,c.input_version,settings.version,JSON.stringify(task),sha(task.payload),new Date(issued+300000),conversation.id,new Date(issued)]);
    await t.pool.query("INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids,created_at) VALUES($1,$2,$3,$4,'{}',$5)",[receiptId,taskId,exactPayloadHash(o),encryptSecret(Buffer.from(JSON.stringify(o)),key,'browser-task-result:'+receiptId),new Date(observed)]);
    await t.pool.query("UPDATE browser_tasks SET state='completed',result_id=$2 WHERE id=$1",[taskId,receiptId]);return {receiptId,observed:o.observedAt};
   };
   for(const age of [300001,-100000]){const oldRead=await agedRead(age),state=await snapshot();assert.equal((await recover({readReceiptId:oldRead.receiptId})).kind,'not_ready');assert.deepEqual(await snapshot(),state);}
   const waitBlocked=async(pid,count)=>{
    const deadline=Date.now()+10000;let blocked=0;
    do{blocked=(await q('SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).n;if(blocked>=count)break;}while(Date.now()<deadline);
    assert.ok(blocked>=count,'Observed actual PostgreSQL blocking, not a timing assumption');
   };
   if(incident===incidents[0]){
    const near=await agedRead(298500),state=await snapshot(),holder=await t.pool.connect();let pending;
    try{
     await holder.query('BEGIN');await holder.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");const pid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
     assert.equal((await q("SELECT $1::timestamptz>clock_timestamp()-interval '5 minutes' AS valid",[near.observed])).valid,true);
     pending=recover({readReceiptId:near.receiptId});await waitBlocked(pid,1);
     while(!(await q("SELECT $1::timestamptz<clock_timestamp()-interval '5 minutes' AS expired",[near.observed])).expired){}
     await holder.query('COMMIT');assert.equal((await pending).kind,'not_ready');assert.deepEqual(await snapshot(),state);
    }finally{await holder.query('ROLLBACK');if(pending)await pending;holder.release();}
    const revoke=await t.pool.connect();let waiting;
    try{
     await revoke.query('BEGIN');await revoke.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");const pid=(await revoke.query('SELECT pg_backend_pid() pid')).rows[0].pid;
     waiting=recover();await waitBlocked(pid,1);await revoke.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[c.id]);await revoke.query('COMMIT');assert.equal((await waiting).kind,'not_ready');assert.deepEqual(await snapshot(),state);
    }finally{await revoke.query('ROLLBACK');if(waiting)await waiting;revoke.release();await t.pool.query('UPDATE candidates SET input_version=$2 WHERE id=$1',[c.id,c.input_version]);}
   }
   const guard=await t.pool.connect(),realDate=Date;let pair,both;
   if(disposition==='requeue')globalThis.Date=class extends realDate{constructor(...args){super(...(args.length?args:[realDate.now()-298500]));}};
   try{await guard.query('BEGIN');await guard.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");const pid=(await guard.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    pair=Promise.all([recover(),recover()]);await waitBlocked(pid,2);await guard.query('COMMIT');both=await pair;
   }finally{globalThis.Date=realDate;await guard.query('ROLLBACK');guard.release();if(pair)await pair;}
   assert.equal(both.filter(r=>r.kind==='recovered'&&!r.repeated).length,1);assert.equal(both.filter(r=>r.kind==='recovered'&&r.repeated).length,1);
   const result=both.find(r=>!r.repeated);assert.equal(result.kind,'recovered');assert.equal(result.disposition,disposition);assert.equal(result.repeated,false);
   assert.deepEqual(await recover(),{...result,repeated:true});
   const after=await snapshot(),audit=await q("SELECT * FROM audit_events WHERE action='alibaba_started_presend_recovery' AND target=$1",[incident.actionId]);
   assert.equal(audit.meta.originalStartedAt,incident.startedAt);assert.equal(audit.meta.originalTaskId,incident.taskId);assert.equal(audit.meta.originalReceiptId,incident.receiptId);
   assert.deepEqual(after.tasks.find(x=>x.id===incident.taskId),before.tasks.find(x=>x.id===incident.taskId));
   for(const field of ['id','body_ciphertext','body_sha256','created_at','inbound_message_id','candidate_id','spec_id','input_version','settings_version'])assert.deepEqual(after.action[field],before.action[field]);
   assert.equal(after.action.state,disposition==='requeue'?'pending':'sent');assert.equal(after.conversation.status,disposition==='requeue'?'queued':'awaiting_reply');
   assert.equal(after.tasks.filter(x=>x.task_kind==='supplier_send').length-before.tasks.filter(x=>x.task_kind==='supplier_send').length,disposition==='requeue'?1:0);
   await assert.rejects(t.pool.query('UPDATE audit_events SET meta=meta WHERE id=$1',[audit.id]),/immutable/);await assert.rejects(t.pool.query('DELETE FROM audit_events WHERE id=$1',[audit.id]),/immutable/);await assert.rejects(t.pool.query("UPDATE audit_events SET action='other' WHERE id=$1",[audit.id]),/immutable/);
   const otherAudit=await q("INSERT INTO audit_events(actor,action,target) VALUES('fixture','presend-other',$1) RETURNING id",[incident.actionId]);await assert.rejects(t.pool.query("UPDATE audit_events SET action='alibaba_started_presend_recovery' WHERE id=$1",[otherAudit.id]),/immutable/);
   await assert.rejects(t.pool.query("UPDATE browser_tasks SET task_hash=repeat('0',64) WHERE id=$1",[incident.taskId]),/immutable/);await assert.rejects(t.pool.query("UPDATE browser_task_results SET body_sha256=repeat('0',64) WHERE id=$1",[incident.receiptId]),/immutable/);
   if(disposition==='requeue'){
    const admitted=await q('SELECT * FROM browser_tasks WHERE id=$1',[result.taskId]),signed=JSON.parse(Buffer.from(admitted.envelope.payload,'base64url').toString());assert.equal(Date.parse(signed.expiresAt)-Date.parse(signed.issuedAt),300000,'The fixture advances age without changing the signed five-minute TTL');
    while(!(await q('SELECT clock_timestamp()>$1::timestamptz AS expired',[signed.expiresAt])).expired){}
    const replacement=await queueAlibabaTask(t.pool,{deviceId:device.id,conversationId:conversation.id,actionId:incident.actionId,encryptionKey:key},signing);
    console.log(JSON.stringify({presendExpiredReplacement:replacement.kind,actionId:incident.actionId,originalCompletedRetained:true}));
    assert.equal(replacement.kind,'queued','An expired never-started incident task must be replaceable despite its preserved original completed send');
    assert.notEqual(replacement.taskId,result.taskId);assert.deepEqual(await q('SELECT * FROM browser_tasks WHERE id=$1',[result.taskId]),{...admitted,state:'cancelled'});assert.deepEqual(await q('SELECT * FROM audit_events WHERE id=$1',[audit.id]),audit);
    const newTask=(await machine('/api/bridge/tasks/claim',{})).body;assert.equal(newTask.taskId,replacement.taskId);assert.equal(JSON.parse(Buffer.from(newTask.envelope.payload,'base64url').toString()).request.body,body);
    assert.equal((await machine('/api/bridge/tasks/'+newTask.taskId+'/dispatch',{taskHash:newTask.taskHash})).body.allowed,true);
    assert.equal((await machine('/api/bridge/tasks/'+newTask.taskId+'/results',{taskHash:newTask.taskHash,observation:{...fresh,actionId:incident.actionId,sendStatus:'unknown',reason:'SEND_OUTCOME_UNKNOWN',observedAt:new Date().toISOString()}})).status,201);
    const retried=await snapshot();assert.equal(retried.action.state,'outcome_unknown');assert.notEqual(retried.action.dispatch_task_id,incident.taskId);
    assert.deepEqual(await recover(),{...result,repeated:true});assert.deepEqual(await snapshot(),retried,'Repeated incident cannot rearm a started retry');
    await assert.rejects(t.pool.query("UPDATE alibaba_actions SET started_at=NULL,dispatch_task_id=NULL,state='pending' WHERE id=$1",[incident.actionId]),/immutable/);
   }else{assert.equal(after.action.sent_message_id,matched.id);assert.equal(after.action.started_at,before.action.started_at);assert.equal(after.action.dispatch_task_id,incident.taskId);}
   console.log(JSON.stringify({presendAdmission:disposition,actionId:incident.actionId,result:'PASS',sameBody:true,immutableMicrosecondHistory:true,negativeChecks:33,rollback:true,idempotent:true,actualConcurrency:true,freshnessCrossingLock:incident===incidents[0],sourceRevocationSerialized:incident===incidents[0],externalSupplierCalls:0}));
  }
 }finally{await t.close();}
}
for(const disposition of ['requeue','reconciled'])await verifyStartedPresend(disposition);

const liveProposal=process.env.FORGE_ALIBABA_AI_PROPOSAL_FILE?JSON.parse(await readFile(process.env.FORGE_ALIBABA_AI_PROPOSAL_FILE,'utf8')):null;
const test=await openAcceptance({databaseKey:'alibaba-server-v4-presend-'+randomUUID()});
const origin='http://localhost:5173',key=Buffer.from(test.encryptionKeyHex,'hex'),keys=browserSigningFixture();
let device,signing,settings;
const machine=async(url,payload)=>{
 const result=await test.app.inject({method:payload===undefined?'GET':'POST',url,headers:{origin,authorization:'Bearer '+device.credential},...(payload===undefined?{}:{payload})});
 return {status:result.statusCode,body:result.json()};
};
const row=async(sql,args)=>(await test.pool.query(sql,args)).rows[0];
const actions=async c=>(await test.pool.query('SELECT * FROM alibaba_actions WHERE conversation_id=$1 ORDER BY created_at,id',[c.id])).rows;
const candidate=async(label,mode='pass')=>{
 const keyword='Synthetic Alibaba '+label+' '+test.runId;
 const c=await row("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'sourcing') RETURNING *",[keyword]);
 await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[c.id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot,mode))]);
 return c;
};
const claim=async queued=>{
 assert.equal(queued.kind,'queued',JSON.stringify(queued));
 const result=await machine('/api/bridge/tasks/claim',{});
 assert.equal(result.status,200);assert.equal(result.body.taskId,queued.taskId,JSON.stringify(result.body));return result.body;
};
const submit=(task,observation)=>machine('/api/bridge/tasks/'+task.taskId+'/results',{taskHash:task.taskHash,observation});
const search=async(c,n=1,suppliedRecords)=>{
 const task=await claim(await queueSupplierSearch(test.pool,{deviceId:device.id,candidateId:c.id},signing));
 const suffix=c.id.replaceAll('-','');
 const records=suppliedRecords??Array.from({length:n},(_,i)=>({companyName:'Synthetic maker '+i,companyUrl:'https://fixture'+suffix+i+'.en.alibaba.com/',productName:'Synthetic product '+i,productUrl:'https://www.alibaba.com/product-detail/synthetic-'+suffix+i+'.html',pageText:'Synthetic maker '+i+' Synthetic product '+i}));
 const observation={protocol:1,kind:'captured',scope:'first_results_page',sourcePageUrl:'https://www.alibaba.com/trade/search?SearchText='+encodeURIComponent(c.keyword_display),query:c.keyword_display,observedAt:new Date().toISOString(),snapshot:'Synthetic suppliers only',visibleCards:records.length,records};
 const result=await submit(task,observation);assert.equal(result.status,201,JSON.stringify(result.body));
 const duplicate=await submit(task,observation);assert.equal(duplicate.status,200);assert.equal(duplicate.body.receiptId,result.body.receiptId);
 return (await test.pool.query('SELECT * FROM alibaba_conversations WHERE candidate_id=$1 ORDER BY company_name',[c.id])).rows;
};
const threadObservation=(c,messages=[],action=null,status='read',threadId=c.id)=>({protocol:1,kind:'captured',scope:'alibaba_thread',conversationId:c.id,actionId:action?.id??null,companyName:c.company_name.toUpperCase(),companyUrl:c.company_url,productUrl:c.product_url,threadId,accountId:'123456789',sourcePageUrl:'https://message.alibaba.com/message/messenger.htm',observedAt:new Date().toISOString(),snapshot:'Synthetic local conversation; no live vendor contacted',messages,sendStatus:status,reason:null});
const queue=(c,action)=>queueAlibabaTask(test.pool,{deviceId:device.id,conversationId:c.id,...(action?{actionId:action.id}:{}),encryptionKey:key},signing);
const anchor=message=>({providerMessageId:message.id,sentAt:message.sentAt,bodySha256:createHash('sha256').update(message.body).digest('hex')});
const proposal=message=>({basedOnInbound:anchor(message),decision:{kind:'reply',body:'Could you quote a lower MOQ and separate the freight, duties and packaging costs for comparison?'},execution:{sessionId:'synthetic-ai-session',provider:'synthetic-provider',model:'synthetic-model'}});
const payload=task=>JSON.parse(Buffer.from(task.envelope.payload,'base64url').toString('utf8'));
const poll=async(c,messages=[],threadId=c.id,proposed)=>{
 const task=await claim(await queue(c));const observation=threadObservation(c,messages,null,'read',threadId);
 if(proposed)observation.proposal=proposed;
 const result=await submit(task,observation);assert.equal(result.status,201,JSON.stringify(result.body));return task;
};
const body=action=>decryptSecret(action.body_ciphertext,key,'alibaba-action:'+action.id).toString();
const start=task=>machine('/api/bridge/tasks/'+task.taskId+'/dispatch',{taskHash:task.taskHash});
const send=async(c,action,messages=[])=>{
 const task=await claim(await queue(c,action));
 const begins=await Promise.all([start(task),start(task)]);
 assert.ok(begins.every(r=>r.status===200));assert.equal(begins.filter(r=>r.body.allowed).length,1,'Concurrent dispatch must authorize exactly once');
 const message={id:'synthetic-'+action.id,direction:'outbound',body:body(action),sentAt:new Date().toISOString()};
 const result=await submit(task,threadObservation(c,[...messages,message],action,'sent'));assert.equal(result.status,201,JSON.stringify(result.body));
 assert.equal((await row('SELECT state FROM alibaba_actions WHERE id=$1',[action.id])).state,'sent');return message;
};
const negotiationFixture=async label=>{
 const c=(await search(await candidate(label)))[0];await poll(c);await prepareAlibabaActions(test.pool,key);
 const sent=await send(c,(await actions(c))[0]);
 const inbound={id:'reply-'+label,direction:'inbound',body:'MOQ 300. USD 4.20 per unit, packaging included. Freight and duties are not quoted.',sentAt:new Date().toISOString()};
 return {c,sent,inbound};
};
const staleDraftFixture=async label=>{
 const f=await negotiationFixture('stale-'+label);await poll(f.c,[f.sent,f.inbound],f.c.id,proposal(f.inbound));
 const draft=(await actions(f.c)).at(-1),task=await claim(await queue(f.c,draft));
 const latest={...f.inbound,id:'new-stale-'+label,sentAt:new Date().toISOString()},messages=[f.sent,f.inbound,latest];
 assert.equal((await submit(task,{...threadObservation(f.c,messages,draft,'not_sent'),reason:'NEGOTIATION_CONTEXT_CHANGED'})).status,201);
 return {...f,draft,task,latest,messages};
};
const retryCount=async c=>(await row("SELECT count(*)::int n FROM audit_events WHERE action='alibaba_ai_retry' AND target=$1",[c.id])).n;
const scheduleOnly=async(c,due=true)=>{
 await recoverAlibabaOutcomes(test.pool);
 await test.pool.query("UPDATE alibaba_conversations c SET next_check_at=clock_timestamp()+interval '1 day' WHERE id<>$1 AND NOT(status='paused' AND reason IS NOT DISTINCT FROM 'THREAD_OWNERSHIP_CONFLICT' AND account_id IS NULL AND provider_thread_id IS NULL AND NOT EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM alibaba_messages m WHERE m.conversation_id=c.id))",[c.id]);
 if(due)await test.pool.query("UPDATE alibaba_conversations SET next_check_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.id]);
 await test.pool.query('UPDATE bridge_devices SET reported_connected=false WHERE id<>$1',[device.id]);
};
const dispatchReads=async(concurrent=false,scheduler=dispatchAlibabaWork)=>{
 assert.equal((await machine('/api/bridge/capabilities',{connected:true,supportedTasks:['supplier_thread'],keyFingerprint:signing.fingerprint})).status,200);
 try{
  const queued=await Promise.all(Array.from({length:concurrent?2:1},()=>scheduler(test.pool,signing,key)));
  return queued.reduce((a,b)=>a+b,0);
 }finally{
  assert.equal((await machine('/api/bridge/capabilities',{connected:true,supportedTasks:['supplier_search','supplier_thread','supplier_send','amazon_search'],keyFingerprint:signing.fingerprint})).status,200);
 }
};
const scheduledRead=async(c,concurrent=false)=>{
 await scheduleOnly(c);assert.equal(await dispatchReads(concurrent),1,'Exactly one scheduled read must be queued');
 const task=await row("SELECT id FROM browser_tasks WHERE conversation_id=$1 AND task_kind='supplier_thread' AND state='queued'",[c.id]);
 assert.ok(task,'The due conversation must be selected by the scheduler');
 return claim({kind:'queued',taskId:task.id});
};
const failAi=async(f,reason='AI_UNAVAILABLE')=>{
 await poll(f.c,[f.sent,f.inbound],f.c.id,{basedOnInbound:anchor(f.inbound),decision:{kind:'review',reason},execution:null});
 assert.equal((await row('SELECT status FROM alibaba_conversations WHERE id=$1',[f.c.id])).status,'attention');
};
const assertCheckIn15Minutes=async c=>{
 const timing=await row('SELECT extract(epoch FROM (next_check_at-clock_timestamp())) AS seconds FROM alibaba_conversations WHERE id=$1',[c.id]);
 assert.ok(Number(timing.seconds)>890&&Number(timing.seconds)<=900,'Next check must remain 15 minutes away: '+timing.seconds);
};
const aiFix='f9e1ad47cb7846000d163477c879e5572eddbecbc772d11459b0f3690250b1de';
const incidentFixture=async(label,prepared)=>{
 const f=prepared??await negotiationFixture('incident-'+label);await failAi(f,'AI_RESPONSE_INVALID');
 f.inboundId=(await row('SELECT id FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=$2',[f.c.id,f.inbound.id])).id;
 f.receiptId=(await row("SELECT result_id FROM browser_tasks WHERE conversation_id=$1 AND state='completed' ORDER BY created_at DESC,id DESC LIMIT 1",[f.c.id])).result_id;
 for(let i=0;i<2;i++)await test.pool.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:alibaba','alibaba_ai_retry',$1,$2::jsonb)",[f.c.id,JSON.stringify({inboundMessageId:f.inboundId})]);
 await test.pool.query('UPDATE alibaba_conversations SET next_check_at=NULL WHERE id=$1',[f.c.id]);return f;
};
const retainedSendIncident=async(label,expired=true,defect=null)=>{
 const c=(await search(await candidate('retained-send-'+label)))[0];await poll(c);await prepareAlibabaActions(test.pool,key);
 const action=(await actions(c))[0],template=await queue(c,action),prior=await row('SELECT * FROM browser_tasks WHERE id=$1',[template.taskId]);
 await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[template.taskId]);
 const id=randomUUID(),stamp=Date.now()-(expired?600000:10000),started=new Date(stamp+1000);
 const unsigned={...JSON.parse(Buffer.from(prior.envelope.payload,'base64url').toString()),id,issuedAt:new Date(stamp).toISOString(),expiresAt:new Date(stamp+300000).toISOString()},envelope=signBrowserTask(unsigned,keys.privateKey);
 await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,action_id,state,delivered_at,first_delivered_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,'supplier_send',$9,$10,'delivered',$11,$11)",[id,device.id,c.candidate_id,c.input_version,c.settings_version,JSON.stringify(envelope),createHash('sha256').update(envelope.payload).digest('hex'),unsigned.expiresAt,c.id,action.id,started]);
 await test.pool.query("UPDATE alibaba_actions SET state='dispatching',started_at=$2,dispatch_task_id=$3 WHERE id=$1",[action.id,started,id]);
 const sent={id:'retained-'+id,direction:'outbound',body:body(action),sentAt:new Date(stamp+2000).toISOString()},inbound={id:'retained-reply-'+id,direction:'inbound',body:'MOQ 300, USD 4.20, freight separately.',sentAt:new Date().toISOString()};
 if(defect==='hash')sent.body='An unrelated outbound message';
 if(defect==='time')sent.sentAt=new Date(started.getTime()-6000).toISOString();
 if(defect==='receipt'){
  const messageId=randomUUID();
  await test.pool.query("INSERT INTO alibaba_messages(id,conversation_id,provider_message_id,direction,body_ciphertext,body_sha256,sent_at,receipt_id) VALUES($1,$2,$3,'outbound',$4,$5,$6,$7)",[messageId,c.id,sent.id,encryptSecret(Buffer.from(sent.body),key,'alibaba-message:'+messageId),createHash('sha256').update(sent.body).digest('hex'),sent.sentAt,c.source_receipt_id]);
 }
 await poll(c,[sent,inbound]);
 if(defect==='hash'||defect==='time'){
  const messageId=(await row('SELECT id FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=$2',[c.id,sent.id])).id;
  await test.pool.query("UPDATE alibaba_actions SET state='sent',sent_message_id=$2 WHERE id=$1",[action.id,messageId]);
  await test.pool.query("UPDATE alibaba_conversations SET status='awaiting_reply',reason=NULL WHERE id=$1",[c.id]);
 }
 assert.equal((await actions(c))[0].state,'sent');
 const f=await incidentFixture(label,{c,sent,inbound,retainedTaskId:id});
 if(defect==='dispatch'){
  assert.equal((await submit({taskId:id,taskHash:createHash('sha256').update(envelope.payload).digest('hex')},threadObservation(c,[sent,inbound],action,'sent'))).status,201);
  const unboundId=randomUUID(),unboundEnvelope=signBrowserTask({...unsigned,id:unboundId},keys.privateKey);
  await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,action_id,state,delivered_at,first_delivered_at) SELECT $2,device_id,candidate_id,spec_id,input_version,settings_version,$3,$4,expires_at,task_kind,conversation_id,action_id,'delivered',delivered_at,first_delivered_at FROM browser_tasks WHERE id=$1",[id,unboundId,JSON.stringify(unboundEnvelope),createHash('sha256').update(unboundEnvelope.payload).digest('hex')]);
  f.retainedTaskId=unboundId;
 }
 return f;
};
const admitAi=(f,overrides={},pool=test.pool,signer=signing)=>queueAlibabaTask(pool,{deviceId:device.id,conversationId:f.c.id,encryptionKey:key,aiRecovery:{inboundMessageId:f.inboundId,failureReceiptId:f.receiptId,fixHash:aiFix,...overrides}},signer);
const incidentState=async f=>row(`SELECT to_jsonb(c) conversation,to_jsonb(p) candidate,
 (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM alibaba_actions a WHERE conversation_id=c.id) actions,
 (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM alibaba_messages m WHERE conversation_id=c.id) messages,
 (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM browser_tasks t WHERE conversation_id=c.id) tasks,
 (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM audit_events e WHERE target=c.id::text) audits
 FROM alibaba_conversations c JOIN candidates p ON p.id=c.candidate_id WHERE c.id=$1`,[f.c.id]);
const incidentConnection=intercept=>({connect:async()=>{
 const db=await test.pool.connect();return {query:async(sql,args)=>intercept(sql,args,()=>db.query(sql,args)),release:()=>db.release()};
}});
try {
 const unauth=await test.app.inject({method:'POST',url:'/api/bridge/tasks/00000000-0000-4000-8000-000000000001/dispatch',payload:{taskHash:'0'.repeat(64)}});
 assert.equal(unauth.statusCode,401);
 settings=await row("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'alibaba-acceptance',snapshot || '{\"supplierContactMode\":\"website\"}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1 RETURNING version,snapshot");
 const identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);signing={origin,privateKey:keys.privateKey,fingerprint:identity.fingerprint};
 const pairing=await test.call('/api/bridge/pairings',{});assert.equal(pairing.status,201);
 const enrolled=await test.app.inject({method:'POST',url:'/api/bridge/pair',headers:{origin},payload:{pairingCode:pairing.body.pairingCode,name:'Synthetic Alibaba acceptance'}});
 assert.equal(enrolled.statusCode,201);device=enrolled.json();
 assert.equal((await machine('/api/bridge/capabilities',{connected:true,supportedTasks:['supplier_search','supplier_thread','supplier_send','amazon_search'],keyFingerprint:identity.fingerprint})).status,200);
 for(const mode of ['caution','unknown'])assert.equal((await queueSupplierSearch(test.pool,{deviceId:device.id,candidateId:(await candidate(mode,mode)).id},signing)).kind,'not_ready','Only exact GO may start');
 const source=await candidate('no specification'),conversations=await search(source,4),c=conversations[0];
 assert.equal(conversations.length,3,'Limit automatic outreach to three distinct companies per candidate');
 assert.equal((await row('SELECT count(*)::int n FROM spec_revisions WHERE candidate_id=$1',[source.id])).n,0,'Never invent a specification');
 assert.equal((await row('SELECT count(*)::int n FROM supplier_captures WHERE candidate_id=$1',[source.id])).n,0,'No-spec evidence must not become a spec-matched capture');
 assert.deepEqual(await contactEligibility(test.pool,source.id,true),{ready:false,reason:'WEBSITE_CONTACT_ACTIVE'});
 await poll(c);await prepareAlibabaActions(test.pool,key);
 let action=(await actions(c))[0];assert.ok(action);assert.match(body(action),/Specifications are not finalized/);assert.match(body(action),/not an order/);assert.match(body(action),/final ZIP\/address TBD/);assert.match(body(action),new RegExp('FK-'+action.id));
 const sent=await send(c,action);
 const activity=(await row('SELECT last_progress_at FROM candidates WHERE id=$1',[source.id])).last_progress_at.getTime();
 await poll(c,[sent]);await prepareAlibabaActions(test.pool,key);
 assert.equal((await actions(c)).length,1);assert.equal((await row('SELECT last_progress_at FROM candidates WHERE id=$1',[source.id])).last_progress_at.getTime(),activity,'Repeated reads do not invent progress');
 const inbound={id:'reply-1',direction:'inbound',body:'MOQ 300. Unit price USD 4.20, DDP freight USD 600, duties included. Packaging box, lead time 20 days.',sentAt:new Date().toISOString()};
 await poll(c,[sent,inbound]);await prepareAlibabaActions(test.pool,key);await prepareAlibabaActions(test.pool,key);
 assert.equal((await actions(c)).length,1,'A read without an AI proposal must never create a template follow-up');
 const aiTask=await claim(await queue(c));assert.deepEqual(payload(aiTask).request.negotiation.lastOutbound,anchor(sent));assert.equal(payload(aiTask).request.negotiation.round,1);
 const aiObservation={...threadObservation(c,[sent,inbound]),proposal:{...proposal(inbound),...(liveProposal?{decision:liveProposal.decision,execution:liveProposal.execution}:{})}};
 assert.equal((await submit(aiTask,aiObservation)).status,201);
 assert.equal((await submit(aiTask,aiObservation)).status,200,'Duplicate AI result keeps the same receipt and action');
 let list=await actions(c);assert.equal(list.length,2,'One validated AI proposal creates one follow-up');action=list[1];assert.equal(action.kind,'followup');assert.ok(body(action).startsWith(aiObservation.proposal.decision.body+'\n'));assert.ok(!action.body_ciphertext.includes(aiObservation.proposal.decision.body));
 const duplicateRead=await poll(c,[sent,inbound],c.id,proposal(inbound));assert.equal(payload(duplicateRead).request.negotiation,undefined);assert.equal((await actions(c)).length,2,'Pending action suppresses another AI proposal');
 const task=await claim(await queue(c,action));assert.deepEqual(payload(task).request.basedOnInbound,anchor(inbound));assert.equal((await start(task)).body.allowed,true);
 const unknown=threadObservation(c,[sent,inbound],action,'unknown');assert.equal((await submit(task,unknown)).status,201);
 assert.equal((await actions(c))[1].state,'outcome_unknown');assert.equal((await queue(c,action)).kind,'not_ready','Unknown send outcomes must not be retried');
 const recovery=await poll(c,[sent,inbound],c.id,proposal(inbound));assert.equal(payload(recovery).request.negotiation,undefined);assert.equal((await actions(c)).length,2,'Unknown sends are read-only even when a proposal is supplied');
 const lateMessage={id:'recovered-reply',direction:'outbound',body:body(action),sentAt:new Date().toISOString()};
 await poll(c,[sent,inbound,lateMessage]);assert.equal((await actions(c))[1].state,'sent','Read-only reconciliation may confirm an uncertain send');
 const binding={id:'binding-1',direction:'inbound',body:'Please pay the deposit and confirm the order.',sentAt:new Date().toISOString()};
 await new Promise(resolve=>setTimeout(resolve,5));
 const afterBinding={id:'binding-2',direction:'inbound',body:'MOQ 300, thanks.',sentAt:new Date().toISOString()};
 await poll(c,[sent,inbound,lateMessage,binding,afterBinding],c.id,proposal(afterBinding));
 assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[c.id])).reason,'BINDING_REQUEST_REQUIRES_REVIEW');assert.equal((await actions(c)).length,2);
 // Given a signed context, changed GO/source/status must preserve the read but reject the proposal.
 for(const change of ['input','spec','go','paused','attention']){
  const f=await negotiationFixture('changed-'+change),read=await claim(await queue(f.c));assert.ok(payload(read).request.negotiation);
  if(change==='input')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[f.c.candidate_id]);
  else if(change==='spec')assert.equal((await test.call('/api/candidates/'+f.c.candidate_id+'/specs',{material:'Silicone',dimensions:'30 cm',packaging:'Paper box',requirements:'Food contact',requestedQuantity:300,source:'Synthetic changed specification'})).status,201);
  else if(change==='go')await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[f.c.candidate_id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot,'caution'))]);
  else await test.pool.query('UPDATE alibaba_conversations SET status=$2 WHERE id=$1',[f.c.id,change]);
  assert.equal((await submit(read,{...threadObservation(f.c,[f.sent,f.inbound]),proposal:proposal(f.inbound)})).status,201);
  assert.equal((await actions(f.c)).length,1,'Changed '+change+' must create no follow-up');
 }
 // Given a current GO, incomplete or obsolete conversation anchors still cannot authorize a reply.
 const anchors=await negotiationFixture('anchors');
 for(const invalid of [{...anchor(anchors.inbound),bodySha256:'0'.repeat(64)},{...anchor(anchors.inbound),providerMessageId:'missing-message'},{...anchor(anchors.inbound),sentAt:anchors.sent.sentAt}]){
  await poll(anchors.c,[anchors.sent,anchors.inbound],anchors.c.id,{...proposal(anchors.inbound),basedOnInbound:invalid});
  assert.equal((await actions(anchors.c)).length,1,'Each inbound anchor field must match stored evidence');
 }
 await poll(anchors.c,[anchors.inbound],anchors.c.id,proposal(anchors.inbound));assert.equal((await actions(anchors.c)).length,1,'Omitted outbound context cannot authorize a reply');
 const newer={...anchors.inbound,id:'newest-inbound',sentAt:new Date().toISOString()};
 await poll(anchors.c,[anchors.sent,anchors.inbound,newer],anchors.c.id,proposal(anchors.inbound));assert.equal((await actions(anchors.c)).length,1,'Newer inbound invalidates the older AI proposal');
 const unconfirmed={id:'manual-outbound',direction:'outbound',body:'Synthetic unconfirmed message',sentAt:new Date().toISOString()};
 await poll(anchors.c,[anchors.sent,anchors.inbound,newer,unconfirmed],anchors.c.id,proposal(newer));assert.equal((await actions(anchors.c)).length,1,'Unconfirmed outbound invalidates the signed AI context');
 for(const incomplete of ['missing-outbound','manual-outbound']){
  const f=await negotiationFixture(incomplete),messages=incomplete==='missing-outbound'?[f.inbound]:[f.sent,f.inbound,{...unconfirmed,id:'unconfirmed-review',sentAt:new Date().toISOString()}];
  await poll(f.c,messages,f.c.id,{basedOnInbound:anchor(f.inbound),decision:{kind:'review',reason:'NEGOTIATION_REQUIRES_REVIEW'},execution:null});
  assert.equal((await actions(f.c)).length,1);assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[f.c.id])).reason,'NEGOTIATION_REQUIRES_REVIEW',incomplete+' must retain its review result');
 }
 // AI failures are durable review states, never fixed template fallbacks.
 for(const reason of ['AI_UNAVAILABLE','AI_RESPONSE_INVALID','NEGOTIATION_CONTEXT_TOO_LARGE','NEGOTIATION_REQUIRES_REVIEW']){
  const f=await negotiationFixture(reason);
  await poll(f.c,[f.sent,f.inbound],f.c.id,{basedOnInbound:anchor(f.inbound),decision:{kind:'review',reason},execution:null});await prepareAlibabaActions(test.pool,key);
  assert.equal((await actions(f.c)).length,1);assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[f.c.id])).reason,reason);
  const read=await poll(f.c,[f.sent,f.inbound]);assert.equal(payload(read).request.negotiation,undefined,'Attention suppresses another AI run');
 }
 const unsafe=await negotiationFixture('unsafe-output');
 await poll(unsafe.c,[unsafe.sent,unsafe.inbound],unsafe.c.id,{...proposal(unsafe.inbound),decision:{kind:'reply',body:'We accept the offer and will pay the deposit.'}});
 assert.equal((await actions(unsafe.c)).length,1);assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[unsafe.c.id])).reason,'BINDING_REQUEST_REQUIRES_REVIEW');
 const noAi=await negotiationFixture('no-execution'),noAiTask=await claim(await queue(noAi.c));
 assert.equal((await submit(noAiTask,{...threadObservation(noAi.c,[noAi.sent,noAi.inbound]),proposal:{...proposal(noAi.inbound),execution:null}})).status,400,'AI reply without execution provenance is invalid');
 await submit(noAiTask,threadObservation(noAi.c,[noAi.sent,noAi.inbound]));await prepareAlibabaActions(test.pool,key);assert.equal((await actions(noAi.c)).length,1);
 // A definite predispatch refusal ends the action, but cannot fabricate a sent or unknown outcome.
 const refused=await negotiationFixture('predispatch-refusal');await poll(refused.c,[refused.sent,refused.inbound],refused.c.id,proposal(refused.inbound));
 const refusedAction=(await actions(refused.c))[1],refusedTask=await claim(await queue(refused.c,refusedAction));
 for(const status of ['sent','unknown'])assert.equal((await submit(refusedTask,threadObservation(refused.c,[refused.sent,refused.inbound],refusedAction,status))).status,400,'Unstarted '+status+' cannot be accepted');
 const refusedObservation={...threadObservation(refused.c,[refused.sent,refused.inbound],refusedAction,'not_sent'),reason:'NEGOTIATION_CONTEXT_CHANGED'};
 assert.equal((await submit(refusedTask,refusedObservation)).status,201,'Definite predispatch not_sent must retain its read receipt');
 assert.equal((await submit(refusedTask,refusedObservation)).status,200);assert.equal((await actions(refused.c))[1].state,'blocked');assert.equal((await actions(refused.c))[1].started_at,null);
 assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[refused.c.id])).reason,'NEGOTIATION_CONTEXT_CHANGED');assert.equal((await queue(refused.c,refusedAction)).kind,'not_ready');
 for(const reason of [null,'SEND_NOT_CONFIRMED']){await test.pool.query('UPDATE alibaba_actions SET reason=$2 WHERE id=$1',[refusedAction.id,reason]);await assert.rejects(test.pool.query("UPDATE alibaba_actions SET state='pending' WHERE id=$1",[refusedAction.id]),/transition rejected/i);}
 await test.pool.query("UPDATE alibaba_actions SET reason='NEGOTIATION_CONTEXT_CHANGED' WHERE id=$1",[refusedAction.id]);
 const failedReceipt=await row('SELECT * FROM browser_task_results WHERE task_id=$1',[refusedTask.taskId]),oldTask=await row('SELECT * FROM browser_tasks WHERE id=$1',[refusedTask.taskId]);
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,failedReceipt.created_at.getTime()-Date.now()+1)));
 const recoveryRead=await claim(await queueAlibabaTask(test.pool,{deviceId:device.id,conversationId:refused.c.id,encryptionKey:key,recoveryRead:true},signing));assert.equal(payload(recoveryRead).request.negotiation,undefined,'Operator recovery reads must not run AI');
 assert.equal((await submit(recoveryRead,threadObservation(refused.c,[refused.sent,refused.inbound]))).status,201);
 const readReceipt=await row('SELECT * FROM browser_task_results WHERE task_id=$1',[recoveryRead.taskId]);
 const rearm=(a=refusedAction,receipts={notSentReceiptId:failedReceipt.id,readReceiptId:readReceipt.id})=>queueAlibabaTask(test.pool,{deviceId:device.id,conversationId:a.conversation_id,actionId:a.id,encryptionKey:key,recovery:receipts},signing);
 assert.equal((await rearm(refusedAction,{notSentReceiptId:readReceipt.id,readReceiptId:failedReceipt.id})).kind,'not_ready','Reversed evidence must not rearm');
 const oldRead=(await row("SELECT result_id FROM browser_tasks WHERE conversation_id=$1 AND task_kind='supplier_thread' AND state='completed' ORDER BY created_at LIMIT 1",[refused.c.id])).result_id;
 assert.equal((await rearm(refusedAction,{notSentReceiptId:failedReceipt.id,readReceiptId:oldRead})).kind,'not_ready','A read before failure cannot authorize recovery');
 await prepareAlibabaActions(test.pool,key);assert.equal((await actions(refused.c))[1].state,'blocked','Ordinary scheduler never rearms');
 const recovered=await Promise.all([rearm(),rearm()]);assert.equal(recovered.filter(v=>v.kind==='queued').length,1,'Explicit concurrent recovery creates exactly one new task');
 const newTask=await claim(recovered.find(v=>v.kind==='queued'));assert.notEqual(newTask.taskId,refusedTask.taskId);assert.deepEqual(payload(newTask).request,payload(refusedTask).request,'Recovery preserves the exact immutable message and inbound anchor');
 assert.deepEqual(await row('SELECT * FROM browser_tasks WHERE id=$1',[refusedTask.taskId]),oldTask);assert.deepEqual(await row('SELECT * FROM browser_task_results WHERE id=$1',[failedReceipt.id]),failedReceipt);
 const rearmed=(await actions(refused.c))[1];for(const field of ['id','body_ciphertext','body_sha256','inbound_message_id','kind','created_at'])assert.deepEqual(rearmed[field],refusedAction[field]);assert.equal((await actions(refused.c)).length,2,'Recovery adds no round');
 assert.equal((await queue(refused.c,refusedAction)).kind,'existing');assert.equal((await submit(refusedTask,refusedObservation)).status,200);assert.equal((await actions(refused.c))[1].state,'pending','Old duplicate receipt cannot block the new attempt');
 const recoveredBegins=await Promise.all([start(newTask),start(newTask)]);assert.equal(recoveredBegins.filter(v=>v.body.allowed).length,1);assert.equal((await rearm()).kind,'not_ready','A started dispatch never rearms');
 assert.equal((await submit(newTask,threadObservation(refused.c,[refused.sent,refused.inbound],refusedAction,'unknown'))).status,201);assert.equal((await rearm()).kind,'not_ready','Unknown outcomes never rearm');
 await test.pool.query("UPDATE alibaba_actions SET state='blocked',reason='NEGOTIATION_CONTEXT_CHANGED' WHERE id=$1",[refusedAction.id]);assert.equal((await rearm()).kind,'not_ready','Started blocked actions never rearm');
 await assert.rejects(test.pool.query("UPDATE alibaba_actions SET state='pending' WHERE id=$1",[refusedAction.id]),/transition rejected/i);
 assert.equal((await rearm((await actions(c))[0])).kind,'not_ready','Sent actions never rearm');
 // Given a pending follow-up, a later inbound must revoke dispatch while its read receipt is retained.
 const fresh=await negotiationFixture('dispatch-freshness');await poll(fresh.c,[fresh.sent,fresh.inbound],fresh.c.id,proposal(fresh.inbound));
 const freshAction=(await actions(fresh.c))[1],freshTask=await claim(await queue(fresh.c,freshAction));
 await poll(fresh.c,[fresh.sent,fresh.inbound,{...fresh.inbound,id:'new-before-dispatch',sentAt:new Date().toISOString()}]);
 assert.equal((await start(freshTask)).body.allowed,false,'New inbound after signing must authorize zero sends');
 assert.equal((await actions(fresh.c))[1].state,'blocked','Stale follow-up must stop instead of being queued forever');assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[fresh.c.id])).reason,'NEGOTIATION_CONTEXT_CHANGED');
 assert.equal((await submit(freshTask,{...threadObservation(fresh.c,[fresh.sent,fresh.inbound],freshAction,'not_sent'),reason:'NEGOTIATION_CONTEXT_CHANGED'})).status,201,'Server-denied unstarted send may still retain a definite not_sent receipt');
 const freshRead=await poll(fresh.c,[fresh.sent,fresh.inbound]);
 assert.equal((await rearm(freshAction,{notSentReceiptId:(await row('SELECT id FROM browser_task_results WHERE task_id=$1',[freshTask.taskId])).id,readReceiptId:(await row('SELECT id FROM browser_task_results WHERE task_id=$1',[freshRead.taskId])).id})).kind,'not_ready','A fresh read cannot hide a newer stored inbound');
 const buyer=await negotiationFixture('buyer-replied');await poll(buyer.c,[buyer.sent,buyer.inbound],buyer.c.id,proposal(buyer.inbound));
 const buyerAction=(await actions(buyer.c))[1],buyerTask=await claim(await queue(buyer.c,buyerAction));
 await poll(buyer.c,[buyer.sent,buyer.inbound,{id:'buyer-manual-reply',direction:'outbound',body:'Synthetic buyer message after AI proposal',sentAt:new Date().toISOString()}]);
 assert.equal((await start(buyerTask)).body.allowed,false,'New outbound after signing must authorize zero sends');
 assert.equal((await actions(buyer.c))[1].state,'blocked');assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[buyer.c.id])).reason,'NEGOTIATION_CONTEXT_CHANGED');
 const siblingFixtures=[];
 for(const boundary of ['claim','begin']){
  const f=await negotiationFixture('server-stale-'+boundary),messages=[f.sent],preserved=[];
  for(let round=1;round<=2;round++){
   const reply={...f.inbound,id:'server-'+boundary+'-sent-'+round,sentAt:new Date().toISOString()};messages.push(reply);
   await poll(f.c,messages,f.c.id,proposal(reply));messages.push(await send(f.c,(await actions(f.c)).at(-1),messages));
  }
  let latest={...f.inbound,id:'server-stale-old-'+boundary,sentAt:new Date().toISOString()};messages.push(latest);
  await poll(f.c,messages,f.c.id,proposal(latest));
  for(let race=0;race<2;race++){
  const draft=(await actions(f.c)).at(-1);
  const reading=boundary==='claim'?await claim(await queue(f.c)):null;
  const readBeforeSend=boundary==='claim'&&race===1;
  let queued=readBeforeSend?null:await queue(f.c,draft);
  const delivered=boundary==='begin'?await claim(queued):null;
  latest={...f.inbound,id:'server-stale-new-'+boundary+'-'+race,sentAt:new Date().toISOString()};messages.push(latest);
  const readObservation=threadObservation(f.c,messages);
  if(reading)assert.equal((await submit(reading,readObservation)).status,201);
  else await poll(f.c,messages);
  if(readBeforeSend){queued=await queue(f.c,draft);assert.ok(Date.parse(readObservation.observedAt)<Date.parse(payload(await row('SELECT envelope FROM browser_tasks WHERE id=$1',[queued.taskId])).issuedAt),'The authenticated newer inbound is already stored before the send task is issued');}
  let authorization=null;
  if(boundary==='claim'){
   const refusedClaim=await machine('/api/bridge/tasks/claim',{});assert.equal(refusedClaim.status,200);assert.equal(refusedClaim.body.kind,'idle');
   const cancelled=await row('SELECT * FROM browser_tasks WHERE id=$1',[queued.taskId]);
   assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.first_delivered_at,null);assert.equal(cancelled.result_id,null,'A refused claim has no browser receipt');
  }else{
   authorization=(await start(delivered)).body;assert.deepEqual(authorization,{allowed:false,reason:'SOURCE_CHANGED'});
   const observation={...threadObservation(f.c,messages,draft,'not_sent'),reason:authorization.reason};
   assert.equal((await submit(delivered,observation)).status,201,'Use the actual begin refusal reason propagated by the bridge');
  }
  const blocked=await row('SELECT * FROM alibaba_actions WHERE id=$1',[draft.id]);
  assert.equal(blocked.state,'blocked');assert.equal(blocked.reason,'NEGOTIATION_CONTEXT_CHANGED');assert.equal(blocked.started_at,null);assert.equal(blocked.dispatch_task_id,null);
  assert.equal((await row("SELECT count(*)::int n FROM audit_events WHERE action='alibaba_send_started' AND target=$1",[draft.id])).n,0);
  const oldTask=await row('SELECT * FROM browser_tasks WHERE id=$1',[queued.taskId]);
  preserved.push({action:blocked,task:oldTask,receipt:oldTask.result_id?await row('SELECT * FROM browser_task_results WHERE id=$1',[oldTask.result_id]):null,readReceiptId:(await row('SELECT receipt_id FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=$2',[f.c.id,latest.id])).receipt_id});
  await prepareAlibabaActions(test.pool,key);const conversation=await row('SELECT status,reason FROM alibaba_conversations WHERE id=$1',[f.c.id]);
  console.log(JSON.stringify({serverStaleBoundary:boundary,race,readBeforeSend,taskState:oldTask.state,hasReceipt:oldTask.result_id!==null,authorization,actionState:blocked.state,startedAt:blocked.started_at,recoveryStatus:conversation.status}));
   assert.equal(conversation.status,'awaiting_reply',boundary+' stale preflight must recover through a fresh read');
   assert.equal((await queue(f.c,draft)).kind,'not_ready','Never resend an obsolete server-refused draft');
   const freshRead=await scheduledRead(f.c,true);assert.equal(payload(freshRead).request.negotiation.round,3);
   assert.equal((await submit(freshRead,{...threadObservation(f.c,messages),proposal:proposal(latest)})).status,201);
   const replacement=(await actions(f.c)).at(-1);assert.notEqual(replacement.id,draft.id);assert.equal(replacement.state,'pending');
   assert.equal(replacement.inbound_message_id,(await row('SELECT id FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=$2',[f.c.id,latest.id])).id);
   assert.deepEqual(await row('SELECT * FROM alibaba_actions WHERE id=$1',[draft.id]),blocked);assert.deepEqual(await row('SELECT * FROM browser_tasks WHERE id=$1',[queued.taskId]),oldTask);
  }
  messages.push(await send(f.c,(await actions(f.c)).at(-1),messages));
  messages.push({...f.inbound,id:'server-fourth-'+boundary,sentAt:new Date().toISOString()});
  assert.equal(payload(await poll(f.c,messages)).request.negotiation,undefined);await prepareAlibabaActions(test.pool,key);
  assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[f.c.id])).reason,'NEGOTIATION_LIMIT_REACHED');
  assert.equal((await actions(f.c)).filter(a=>a.kind==='followup'&&a.state==='sent').length,3);assert.equal((await actions(f.c)).length,6);
  for(const old of preserved){
   assert.deepEqual(await row('SELECT * FROM alibaba_actions WHERE id=$1',[old.action.id]),old.action);
   assert.deepEqual(await row('SELECT * FROM browser_tasks WHERE id=$1',[old.task.id]),old.task);
   if(old.receipt)assert.deepEqual(await row('SELECT * FROM browser_task_results WHERE id=$1',[old.receipt.id]),old.receipt);
  }
  const conversation=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[f.c.id]),allActions=await actions(f.c),stored=(await test.pool.query('SELECT * FROM alibaba_messages WHERE conversation_id=$1',[f.c.id])).rows;
  assert.deepEqual(await alibabaStaleDraftIds(test.pool,conversation,allActions,stored,key),new Set(preserved.map(p=>p.action.id)),'Historical '+boundary+' proof survives newer receipts and a legitimate replacement outbound');
  siblingFixtures.push({f,preserved,conversation,allActions,stored});
 }
 const claimFixture=siblingFixtures[0],claimOld=claimFixture.preserved.at(-1),claimOldInbound=claimFixture.stored.find(m=>m.id===claimOld.action.inbound_message_id);
 const cancelledDefects=['first-delivered','delivered','result-id','result-row','state','send-signature','missing-read','read-result-id','read-task-id','read-device','read-kind','read-hash','read-signature','read-source','read-new-missing','read-old-missing','read-outbound','read-time','read-identity','read-reason'];
 for(const defect of cancelledDefects){
  const db={query:async(sql,args)=>{
   const result=await test.pool.query(sql,args);if(!sql.includes('r.id=t.result_id'))return result;
   return {...result,rows:result.rows.flatMap(original=>{
    const r=structuredClone(original);
    if(r.task_id===claimOld.task.id){
     if(defect==='first-delivered')r.first_delivered_at=new Date();if(defect==='delivered')r.delivered_at=new Date();
     if(defect==='result-id')r.result_id=randomUUID();if(defect==='result-row')r.has_result=true;if(defect==='state')r.state='delivered';
     if(defect==='send-signature')r.envelope.signature=Buffer.alloc(64).toString('base64url');
    }
    if(r.id===claimOld.readReceiptId){
     if(defect==='missing-read')return [];
     if(defect==='read-result-id')r.result_id=randomUUID();if(defect==='read-task-id')r.receipt_task_id=randomUUID();if(defect==='read-device')r.device_id=randomUUID();if(defect==='read-kind')r.task_kind='supplier_send';
     if(defect==='read-hash')r.body_sha256='0'.repeat(64);if(defect==='read-signature')r.envelope.signature=Buffer.alloc(64).toString('base64url');
     if(defect==='read-source'){const task=JSON.parse(Buffer.from(r.envelope.payload,'base64url').toString());task.request.inputVersion++;r.envelope=signBrowserTask(task,keys.privateKey);r.task_hash=createHash('sha256').update(r.envelope.payload).digest('hex');}
     if(['read-new-missing','read-old-missing','read-outbound','read-time','read-identity','read-reason'].includes(defect)){
      const o=JSON.parse(decryptSecret(r.body_ciphertext,key,'browser-task-result:'+r.id).toString());
      if(defect==='read-new-missing')o.messages=o.messages.filter(m=>Date.parse(m.sentAt)<=claimOldInbound.sent_at.getTime());
      if(defect==='read-old-missing')o.messages=o.messages.filter(m=>m.id!==claimOldInbound.provider_message_id);
      if(defect==='read-outbound')o.messages.push({id:'server-manual',direction:'outbound',body:'A buyer reply',sentAt:o.observedAt});
      if(defect==='read-time')o.observedAt=new Date(Date.parse(JSON.parse(Buffer.from(r.envelope.payload,'base64url').toString()).issuedAt)-1).toISOString();
      if(defect==='read-identity')o.messages[0].body='Changed historical identity';if(defect==='read-reason')o.reason='NEGOTIATION_CONTEXT_CHANGED';
      r.body_ciphertext=encryptSecret(Buffer.from(JSON.stringify(o)),key,'browser-task-result:'+r.id);r.body_sha256=exactPayloadHash(o);
     }
    }return [r];
   })};
  }};
  assert.equal((await alibabaStaleDraftIds(db,claimFixture.conversation,claimFixture.allActions,claimFixture.stored,key)).has(claimOld.action.id),false,defect+' must not classify a cancelled send');
 }
 const beginFixture=siblingFixtures[1],beginOld=beginFixture.preserved.at(-1),beginInbound=beginFixture.stored.find(m=>m.id===beginOld.action.inbound_message_id);
 const incompleteBegin={query:async(sql,args)=>{
  const result=await test.pool.query(sql,args);return {...result,rows:result.rows.map(original=>{
   if(original.id!==beginOld.receipt.id||!original.body_ciphertext)return original;
   const r=structuredClone(original),o=JSON.parse(decryptSecret(r.body_ciphertext,key,'browser-task-result:'+r.id).toString());o.messages=o.messages.filter(m=>Date.parse(m.sentAt)<=beginInbound.sent_at.getTime());r.body_ciphertext=encryptSecret(Buffer.from(JSON.stringify(o)),key,'browser-task-result:'+r.id);r.body_sha256=exactPayloadHash(o);return r;
  })};
 }};
 assert.equal((await alibabaStaleDraftIds(incompleteBegin,beginFixture.conversation,beginFixture.allActions,beginFixture.stored,key)).has(beginOld.action.id),false,'SOURCE_CHANGED without observed newer inbound remains ineligible');
 const strayReceipt=randomUUID(),strayObservation=threadObservation(claimFixture.f.c,[],claimOld.action,'not_sent');
 await test.pool.query("INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids) VALUES($1,$2,$3,$4,'{}')",[strayReceipt,claimOld.task.id,exactPayloadHash(strayObservation),encryptSecret(Buffer.from(JSON.stringify(strayObservation)),key,'browser-task-result:'+strayReceipt)]);
 assert.equal((await alibabaStaleDraftIds(test.pool,claimFixture.conversation,claimFixture.allActions,claimFixture.stored,key)).has(claimOld.action.id),false,'A real result row with a NULL task result pointer disqualifies cancelled history');
 console.log(JSON.stringify({serverStaleChecks:['claim cancelled never delivered','newer read stored before send issued','begin actual SOURCE_CHANGED','two consecutive races at each boundary','fresh latest third proposal and send','fourth refused','immutable action/task/receipt history','historical receipt persists after replacement','cancelled delivery/result exclusions','read provenance and contradiction negatives','partial SOURCE_CHANGED refusal'],externalSupplierCalls:0}));
 // Two separate supplier replies may invalidate successive, never-started third drafts.
 const staleRace=await negotiationFixture('durable-stale-draft');const staleHistory=[staleRace.sent],staleObsolete=[];
 for(let round=1;round<=2;round++){
  const reply={...staleRace.inbound,id:'stale-sent-round-'+round,sentAt:new Date().toISOString()};staleHistory.push(reply);
  await poll(staleRace.c,staleHistory,staleRace.c.id,proposal(reply));staleHistory.push(await send(staleRace.c,(await actions(staleRace.c)).at(-1),staleHistory));
 }
 let staleLatest={...staleRace.inbound,id:'stale-basis-0',sentAt:new Date().toISOString()};staleHistory.push(staleLatest);
 await poll(staleRace.c,staleHistory,staleRace.c.id,proposal(staleLatest));
 for(let race=0;race<2;race++){
  const draft=(await actions(staleRace.c)).at(-1),task=await claim(await queue(staleRace.c,draft));
  staleLatest={...staleRace.inbound,id:'stale-basis-'+(race+1),sentAt:new Date().toISOString()};staleHistory.push(staleLatest);
  const observation={...threadObservation(staleRace.c,staleHistory,draft,'not_sent'),reason:'NEGOTIATION_CONTEXT_CHANGED'};
  assert.equal((await submit(task,observation)).status,201);
  const preserved={action:await row('SELECT * FROM alibaba_actions WHERE id=$1',[draft.id]),task:await row('SELECT * FROM browser_tasks WHERE id=$1',[task.taskId]),receipt:await row('SELECT * FROM browser_task_results WHERE task_id=$1',[task.taskId])};staleObsolete.push(preserved);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,preserved.receipt.created_at.getTime()-Date.now()+1)));
  const rearmRead=await claim(await queueAlibabaTask(test.pool,{deviceId:device.id,conversationId:staleRace.c.id,encryptionKey:key,recoveryRead:true},signing));
  assert.equal((await submit(rearmRead,threadObservation(staleRace.c,staleHistory))).status,201);
  const rearmReceipt=await row('SELECT id FROM browser_task_results WHERE task_id=$1',[rearmRead.taskId]);
  assert.equal((await queueAlibabaTask(test.pool,{deviceId:device.id,conversationId:staleRace.c.id,actionId:draft.id,encryptionKey:key,recovery:{notSentReceiptId:preserved.receipt.id,readReceiptId:rearmReceipt.id}},signing)).kind,'not_ready','0052 recovery cannot reuse an old anchor after an immutable newer inbound');
  if(race===0){
   const transition=await test.pool.connect();
   try{await transition.query('BEGIN');assert.equal((await transition.query("UPDATE alibaba_actions SET state='pending',reason=NULL WHERE id=$1 RETURNING id",[draft.id])).rowCount,1,'0052 permits the SQL transition; current-anchor application checks are essential');}
   finally{await transition.query('ROLLBACK');transition.release();}
  }
  if(race===0){
   const holder=await test.pool.connect();let contenders;
   try{
    await holder.query('BEGIN');await holder.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");const pid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    contenders=Promise.all([prepareAlibabaActions(test.pool,key),prepareAlibabaActions(test.pool,key)]);let blocked=0;
    for(let check=0;check<200&&blocked<2;check++)blocked=(await row('SELECT count(*)::int n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid])).n;
    assert.equal(blocked,2,'Both stale-draft recovery workers must really wait on the shared transaction lock');await holder.query('COMMIT');await contenders;
   }finally{await holder.query('ROLLBACK');if(contenders)await contenders;holder.release();}
  }else await prepareAlibabaActions(test.pool,key);
  assert.equal((await row('SELECT status FROM alibaba_conversations WHERE id=$1',[staleRace.c.id])).status,'awaiting_reply','Authenticated stale unstarted drafts must release the next fresh read without rewriting the draft');
  assert.equal((await queue(staleRace.c,draft)).kind,'not_ready','The old blocked draft never becomes sendable');
  const read=await scheduledRead(staleRace.c,true);assert.equal(payload(read).request.negotiation.round,3,'Both stale allocations leave only the third real followup available');
  assert.equal((await submit(read,{...threadObservation(staleRace.c,staleHistory),proposal:proposal(staleLatest)})).status,201);
  assert.equal((await actions(staleRace.c)).at(-1).state,'pending','Fresh latest-inbound proposal creates its own action');
  assert.equal((await submit(task,observation)).status,200,'Old refusal replay remains idempotent');
 }
 staleHistory.push(await send(staleRace.c,(await actions(staleRace.c)).at(-1),staleHistory));
 for(const saved of staleObsolete){
  assert.deepEqual(await row('SELECT * FROM alibaba_actions WHERE id=$1',[saved.action.id]),saved.action);
  assert.deepEqual(await row('SELECT * FROM browser_tasks WHERE id=$1',[saved.task.id]),saved.task);
  assert.deepEqual(await row('SELECT * FROM browser_task_results WHERE id=$1',[saved.receipt.id]),saved.receipt);
  await assert.rejects(test.pool.query("INSERT INTO alibaba_actions(id,conversation_id,candidate_id,spec_id,input_version,settings_version,kind,inbound_message_id,body_ciphertext,body_sha256) SELECT $2,conversation_id,candidate_id,spec_id,input_version,settings_version,kind,inbound_message_id,body_ciphertext,body_sha256 FROM alibaba_actions WHERE id=$1",[saved.action.id,randomUUID()]),/alibaba_inbound_once/,'Obsolete inbound remains reserved by immutable history');
 }
 staleHistory.push({...staleRace.inbound,id:'stale-fourth-real-round',sentAt:new Date().toISOString()});
 const staleExhausted=await poll(staleRace.c,staleHistory);assert.equal(payload(staleExhausted).request.negotiation,undefined);
 await prepareAlibabaActions(test.pool,key);assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[staleRace.c.id])).reason,'NEGOTIATION_LIMIT_REACHED','Classification persists after the legitimate replacement outbound');
 assert.equal((await actions(staleRace.c)).filter(a=>a.kind==='followup'&&a.state==='sent').length,3);assert.equal((await actions(staleRace.c)).length,6,'Two obsolete drafts stay visible without permitting a fourth real followup');
 const staleConversation=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[staleRace.c.id]),staleActions=await actions(staleRace.c),staleMessages=(await test.pool.query('SELECT * FROM alibaba_messages WHERE conversation_id=$1',[staleRace.c.id])).rows;
 const classify=(db=test.pool,c=staleConversation,a=staleActions,m=staleMessages)=>alibabaStaleDraftIds(db,c,a,m,key);
 assert.deepEqual(await classify(),new Set(staleObsolete.map(saved=>saved.action.id)),'Later legitimate outbound never erases historical stale classification');
 const damaged=staleObsolete[0],proofDefects=['missing','id','task_id','result_id','action_id','device_id','candidate_id','spec_id','input_version','settings_version','task_hash','body_sha256','signature','schema','account','thread','body','old-anchor','new-inbound','reason','original-outbound','observed','message-identity'];
 for(const defect of proofDefects){
  const db={query:async(sql,args)=>{
   const result=await test.pool.query(sql,args);if(!sql.includes('r.id=t.result_id'))return result;
   return {...result,rows:result.rows.flatMap(original=>{
    if(original.id!==damaged.receipt.id)return [original];if(defect==='missing')return [];
    const r=structuredClone(original);
    if(['id','task_id','result_id','action_id','device_id','candidate_id','spec_id'].includes(defect))r[defect]=randomUUID();
    else if(['input_version','settings_version'].includes(defect))r[defect]++;
    else if(['task_hash','body_sha256'].includes(defect))r[defect]='0'.repeat(64);
    else if(defect==='signature')r.envelope.signature=Buffer.alloc(64).toString('base64url');
    else if(['account','thread','body','old-anchor'].includes(defect)){
     const signed=JSON.parse(Buffer.from(r.envelope.payload,'base64url').toString());
     if(defect==='account')signed.request.accountId='998877';if(defect==='thread')signed.request.threadId='wrong-thread';if(defect==='body')signed.request.body='Unrelated quotation';if(defect==='old-anchor')signed.request.basedOnInbound.bodySha256='0'.repeat(64);
     r.envelope=signBrowserTask(signed,keys.privateKey);r.task_hash=createHash('sha256').update(r.envelope.payload).digest('hex');
    }else{
     const o=JSON.parse(decryptSecret(r.body_ciphertext,key,'browser-task-result:'+r.id).toString());
     if(defect==='schema')o.sendStatus='sent';if(defect==='reason')o.reason='SEND_NOT_CONFIRMED';
     if(defect==='new-inbound')o.messages=o.messages.filter(m=>m.id!=='stale-basis-1');
     if(defect==='original-outbound')o.messages.push({id:'contradiction',direction:'outbound',body:'A manual reply',sentAt:o.observedAt});
     if(defect==='observed')o.observedAt='2000-01-01T00:00:00.000Z';if(defect==='message-identity')o.messages[0].body='Changed provider message';
     r.body_ciphertext=encryptSecret(Buffer.from(JSON.stringify(o)),key,'browser-task-result:'+r.id);r.body_sha256=exactPayloadHash(o);
    }return [r];
   })};
  }};
  assert.equal((await classify(db)).has(damaged.action.id),false,defect+' cannot classify an unauthenticated obsolete draft');
 }
 for(const defect of ['initial','pending','cancelled','outcome_unknown','started','dispatch','sent-message','reason']){
  const changed=staleActions.map(a=>a.id!==damaged.action.id?a:{...a,...(defect==='initial'?{kind:'initial'}:defect==='started'?{started_at:new Date()}:defect==='dispatch'?{dispatch_task_id:randomUUID()}:defect==='sent-message'?{sent_message_id:staleMessages[0].id}:defect==='reason'?{reason:'SEND_NOT_CONFIRMED'}:{state:defect})});
  assert.equal((await classify(test.pool,staleConversation,changed)).has(damaged.action.id),false,defect+' is never an obsolete unstarted allocation');
 }
 const contradiction={...staleMessages.find(m=>m.direction==='outbound'),id:randomUUID(),provider_message_id:'obsolete-body-outbound',body_sha256:damaged.action.body_sha256};
 assert.equal((await classify(test.pool,staleConversation,staleActions,[...staleMessages,contradiction])).has(damaged.action.id),false,'Current exact obsolete-body outbound must hold');
 assert.equal((await classify(test.pool,{...staleConversation,reason:'MESSAGE_IDENTITY_CONFLICT'})).size,0);
 await test.pool.query("INSERT INTO audit_events(actor,action,target) VALUES('test','alibaba_send_started',$1)",[damaged.action.id]);assert.equal((await classify()).has(damaged.action.id),false,'Even a start audit without a started timestamp refuses classification');
 for(const boundary of ['source','manual','binding','other-blocked']){
  const f=await staleDraftFixture(boundary);
  if(boundary==='source')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[f.c.candidate_id]);
  if(boundary==='manual')await poll(f.c,[...f.messages,{id:'manual-stale-reply',direction:'outbound',body:'A buyer reply',sentAt:new Date().toISOString()}]);
  if(boundary==='binding')await poll(f.c,[...f.messages,{...f.latest,id:'binding-stale-reply',body:'Please pay the deposit.',sentAt:new Date().toISOString()}]);
  if(boundary==='other-blocked')await test.pool.query("UPDATE alibaba_actions SET reason='SEND_NOT_CONFIRMED' WHERE id=$1",[f.draft.id]);
  const before=await actions(f.c);await prepareAlibabaActions(test.pool,key);assert.equal((await row('SELECT status FROM alibaba_conversations WHERE id=$1',[f.c.id])).status,'attention',boundary+' must not resume negotiation');assert.deepEqual(await actions(f.c),before);
 }
 console.log(JSON.stringify({staleDraftChecks:['two consecutive fresh-inbound races','immutable blocked history','fresh round-three proposal','old draft never rearmed','all-history inbound reservation','classification persists after replacement send','fourth actual followup refused','actual concurrent lock and read dedup','authenticated proof refusal matrix','started unknown and audit refusal','current exact-body and identity contradiction','source manual binding and other-blocked hold'],externalSupplierCalls:0}));
 // Given three sent follow-ups, one more reply must stop without a fourth action.
 const limited=await negotiationFixture('round-limit');let history=[limited.sent];
 for(let round=1;round<=3;round++){
  const reply={...limited.inbound,id:'round-'+round,sentAt:new Date().toISOString()};history.push(reply);
  const read=await poll(limited.c,history,limited.c.id,proposal(reply));assert.equal(payload(read).request.negotiation.round,round);
  history.push(await send(limited.c,(await actions(limited.c)).at(-1),history));
 }
 history.push({...limited.inbound,id:'round-four',sentAt:new Date().toISOString()});const exhausted=await poll(limited.c,history);assert.equal(payload(exhausted).request.negotiation,undefined);await prepareAlibabaActions(test.pool,key);
 assert.equal((await actions(limited.c)).length,4);assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[limited.c.id])).reason,'NEGOTIATION_LIMIT_REACHED');
 const ownership=(await search(await candidate('ownership')))[0];await poll(ownership,[],c.id);
 assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[ownership.id])).reason,'THREAD_OWNERSHIP_CONFLICT');assert.equal((await actions(ownership)).length,0);
 const stale=(await search(await candidate('scope change')))[0];await poll(stale);await prepareAlibabaActions(test.pool,key);
 const staleAction=(await actions(stale))[0],staleTask=await claim(await queue(stale,staleAction));
 await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[stale.candidate_id]);
 assert.equal((await start(staleTask)).body.allowed,false,'Input changes revoke an unstarted send');
 const late=(await search(await candidate('late receipt')))[0];await poll(late);await prepareAlibabaActions(test.pool,key);
 const lateAction=(await actions(late))[0],lateTask=await claim(await queue(late,lateAction));assert.equal((await start(lateTask)).body.allowed,true);
 await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[late.candidate_id]);await prepareAlibabaActions(test.pool,key);
 const lateSent={id:'late-sent',direction:'outbound',body:body(lateAction),sentAt:new Date().toISOString()};
 assert.equal((await submit(lateTask,threadObservation(late,[lateSent],lateAction,'sent'))).status,201,'Facts from started sends survive a changed GO scope');
 assert.equal((await actions(late))[0].state,'sent');
 const expiry=(await search(await candidate('expired send receipt')))[0];await poll(expiry);await prepareAlibabaActions(test.pool,key);
 const expiryAction=(await actions(expiry))[0],expiryId=randomUUID(),clock=Date.now();
 const request={kind:'supplier_send',candidateId:expiry.candidate_id,specId:null,inputVersion:expiry.input_version,settingsVersion:expiry.settings_version,conversationId:expiry.id,companyName:expiry.company_name,companyUrl:expiry.company_url,productUrl:expiry.product_url,threadId:expiry.id,accountId:'123456789',actionId:expiryAction.id,body:body(expiryAction)};
 const envelope=signBrowserTask({version:1,id:expiryId,issuerOrigin:origin,deviceId:device.id,issuedAt:new Date(clock-1000).toISOString(),expiresAt:new Date(clock+2000).toISOString(),request},keys.privateKey);
 const expiryHash=createHash('sha256').update(envelope.payload).digest('hex');
 await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,action_id) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,'supplier_send',$9,$10)",[expiryId,device.id,expiry.candidate_id,expiry.input_version,expiry.settings_version,JSON.stringify(envelope),expiryHash,new Date(clock+2000),expiry.id,expiryAction.id]);
 const expiringTask=await claim({kind:'queued',taskId:expiryId});assert.equal((await start(expiringTask)).body.allowed,true);
 await new Promise(resolve=>setTimeout(resolve,2100));
 await test.pool.query("UPDATE browser_tasks SET delivered_at=now()-interval '151 seconds' WHERE id=$1",[expiryId]);
 assert.equal((await machine('/api/bridge/tasks/claim',{})).body.kind,'idle','A started send is never reclaimed even after both leases expire');
 assert.equal((await row('SELECT state FROM browser_tasks WHERE id=$1',[expiryId])).state,'delivered','Started send must not be cancelled by generic expiry');
 assert.equal((await start(expiringTask)).body.allowed,false);
 const expirySent={id:'expired-sent',direction:'outbound',body:body(expiryAction),sentAt:new Date().toISOString()};
 assert.equal((await submit(expiringTask,threadObservation(expiry,[expirySent],expiryAction,'sent'))).status,201,'Durable started-send receipt survives signed task expiry');
 assert.equal((await actions(expiry))[0].state,'sent');
 const multibyte=await candidate('multibyte specification');
 assert.equal((await test.call('/api/candidates/'+multibyte.id+'/specs',{material:'가'.repeat(600),dimensions:'나'.repeat(600),packaging:'다'.repeat(600),requirements:'라'.repeat(600),requestedQuantity:300,source:'Synthetic byte-budget acceptance'})).status,201);
 const large=(await search(multibyte))[0];await poll(large);await prepareAlibabaActions(test.pool,key);
 const largeAction=(await actions(large))[0];assert.ok(largeAction,'Fixture must reach signed byte-budget guard');assert.ok(body(largeAction).length<=4000);
 assert.equal((await queue(large,largeAction)).kind,'not_ready','Oversized multibyte message must not poison other browser work');
 assert.equal((await actions(large))[0].state,'blocked');assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[large.id])).reason,'INQUIRY_TOO_LONG');
 const fairConversation=(await search(await candidate('research fairness')))[0];
 const waitingResearch=await row("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING *",['waiting research '+test.runId]);
 const oldResearchId=randomUUID(),oldClock=Date.now()-3600000;
 const oldResearchEnvelope=signBrowserTask({version:1,id:oldResearchId,issuerOrigin:origin,deviceId:device.id,issuedAt:new Date(oldClock).toISOString(),expiresAt:new Date(oldClock+300000).toISOString(),request:{kind:'amazon_search',candidateId:waitingResearch.id,inputVersion:waitingResearch.input_version,settingsVersion:settings.version,query:waitingResearch.keyword_display}},keys.privateKey);
 await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,'amazon_search',$9)",[oldResearchId,device.id,waitingResearch.id,waitingResearch.input_version,settings.version,JSON.stringify(oldResearchEnvelope),createHash('sha256').update(oldResearchEnvelope.payload).digest('hex'),new Date(oldClock+300000),new Date(oldClock)]);
 const waitingThread=await queue(fairConversation);
 const renewedResearch=await queueAmazonSearch(test.pool,{deviceId:device.id,candidateId:waitingResearch.id},signing);
 assert.equal((await row('SELECT state FROM browser_tasks WHERE id=$1',[oldResearchId])).state,'cancelled');
 const fairClaim=await machine('/api/bridge/tasks/claim',{});
 assert.equal(fairClaim.body.taskId,renewedResearch.taskId,'Re-signed unclaimed research keeps its original waiting turn ahead of newer conversations');
 const laterResearch=await row("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING *",['later research '+test.runId]);
 const laterTask=await queueAmazonSearch(test.pool,{deviceId:device.id,candidateId:laterResearch.id},signing);
 const fairThread=await claim(waitingThread);
 assert.equal((await submit(fairThread,threadObservation(fairConversation))).status,201,'A waiting supplier conversation still completes after the research turn');
 await claim(laterTask);
 await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=ANY($1::uuid[])",[[renewedResearch.taskId,laterTask.taskId]]);
 const yieldingSearch=await queueSupplierSearch(test.pool,{deviceId:device.id,candidateId:(await candidate('yielding search')).id},signing);
 const verdictResearch=await row("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING *",['verdict research '+test.runId]);
 const verdictTask=await queueAmazonSearch(test.pool,{deviceId:device.id,candidateId:verdictResearch.id},signing);
 assert.equal(yieldingSearch.kind,'queued');assert.equal((await machine('/api/bridge/tasks/claim',{})).body.taskId,verdictTask.taskId,'A newer Amazon verdict read goes ahead of a recent supplier search');
 await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=ANY($1::uuid[])",[[yieldingSearch.taskId,verdictTask.taskId]]);
 // Technical AI recovery is due-only, audit-backed, and bounded independently for each inbound.
 for(const reason of ['AI_UNAVAILABLE','AI_RESPONSE_INVALID']){
  const f=await negotiationFixture('retry-'+reason);await failAi(f,reason);
  await assertCheckIn15Minutes(f.c);await scheduleOnly(f.c,false);
  assert.equal(await dispatchReads(),0,'Technical failure must wait for its next check');assert.equal(await retryCount(f.c),0);
  for(let attempt=1;attempt<=2;attempt++){
   const read=await scheduledRead(f.c,true);assert.ok(payload(read).request.negotiation,'Due technical failure must retry AI');
   assert.equal(await retryCount(f.c),attempt,'Concurrent schedulers must record one retry only');
   assert.equal((await actions(f.c)).length,1,'Retrying AI creates no template or resend action');
   const inboundId=(await row('SELECT id FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=$2',[f.c.id,f.inbound.id])).id;
   assert.equal((await row("SELECT meta->>'inboundMessageId' AS inbound FROM audit_events WHERE action='alibaba_ai_retry' AND target=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[f.c.id])).inbound,inboundId);
   const failed={...threadObservation(f.c,[f.sent,f.inbound]),proposal:{basedOnInbound:anchor(f.inbound),decision:{kind:'review',reason},execution:null}};
   assert.equal((await submit(read,failed)).status,201);assert.equal((await submit(read,failed)).status,200);
   if(attempt===1)await assertCheckIn15Minutes(f.c);
  }
  assert.deepEqual(await row('SELECT status,reason,next_check_at FROM alibaba_conversations WHERE id=$1',[f.c.id]),{status:'attention',reason,next_check_at:null});
  await scheduleOnly(f.c,false);
  assert.equal(await dispatchReads(),0,'Original plus two failed retries must stop');
  assert.equal(await dispatchReads(),0,'Repeated scheduler calls cannot reset the persisted cap');
  assert.equal(await retryCount(f.c),2);assert.equal((await actions(f.c)).length,1);
 }
 // An exhausted parser incident admits one concrete fresh proposal read without resetting normal retries.
 const incident=await incidentFixture('admission'),incidentBefore=await incidentState(incident);
 const admitted=await admitAi(incident);assert.equal(admitted.kind,'queued');
 const incidentTask=await claim(admitted);
 assert.ok(payload(incidentTask).request.negotiation,'Incident admission must sign a negotiation context while the conversation is still attention');
 assert.equal(payload(incidentTask).request.negotiation.round,1);
 assert.deepEqual(payload(incidentTask).request.negotiation.lastOutbound,anchor(incident.sent));
 assert.equal(await retryCount(incident.c),2);
 const incidentAfter=await incidentState(incident);
 assert.deepEqual(incidentAfter.actions,incidentBefore.actions);assert.deepEqual(incidentAfter.messages,incidentBefore.messages);
 assert.deepEqual(incidentAfter.audits.filter(e=>e.action==='alibaba_ai_retry'),incidentBefore.audits);
 const admission=incidentAfter.audits.find(e=>e.action==='alibaba_ai_incident_admission');
 assert.equal(admission.meta.incident,'alibaba-json-string-whitespace-20260930');assert.equal(admission.meta.inboundMessageId,incident.inboundId);
 assert.equal(admission.meta.newTaskId,admitted.taskId);assert.equal(admission.meta.failureReceiptId,incident.receiptId);assert.equal(admission.meta.fixHash,aiFix);
 assert.equal(incidentAfter.conversation.status,'awaiting_reply');assert.equal(incidentAfter.conversation.reason,null);
 const repeatedBefore=await incidentState(incident);assert.equal((await admitAi(incident)).kind,'not_ready');assert.deepEqual(await incidentState(incident),repeatedBefore);
 const incidentFailure={...threadObservation(incident.c,[incident.sent,incident.inbound]),proposal:{basedOnInbound:anchor(incident.inbound),decision:{kind:'review',reason:'AI_RESPONSE_INVALID'},execution:null}};
 assert.equal((await submit(incidentTask,incidentFailure)).status,201);
 await scheduleOnly(incident.c,false);assert.equal(await dispatchReads(),0,'Another accepted failure cannot restart the exhausted normal retries');
 assert.equal(await retryCount(incident.c),2);assert.equal((await admitAi(incident)).kind,'not_ready');
 for(const boundary of ['wrong-fix','stale-inbound','wrong-receipt','one-retry','three-retries','other-reason','paused','input','spec','settings','go','stage','manual-outbound','binding','pending','dispatching','outcome_unknown','blocked','cancelled','used-inbound','fourth-round','queued','delivered','expired-queued','expired-delivered']){
  const f=await incidentFixture(boundary);let overrides={};
  if(boundary==='wrong-fix')overrides.fixHash='0'.repeat(64);
  if(boundary==='stale-inbound')overrides.inboundMessageId=randomUUID();
  if(boundary==='wrong-receipt')overrides.failureReceiptId=randomUUID();
  if(boundary==='one-retry')await test.pool.query("DELETE FROM audit_events WHERE id=(SELECT id FROM audit_events WHERE action='alibaba_ai_retry' AND target=$1 LIMIT 1)",[f.c.id]);
  if(boundary==='three-retries')await test.pool.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('test','alibaba_ai_retry',$1,$2)",[f.c.id,JSON.stringify({inboundMessageId:f.inboundId})]);
  if(boundary==='other-reason')await test.pool.query("UPDATE alibaba_conversations SET reason='AI_UNAVAILABLE' WHERE id=$1",[f.c.id]);
  if(boundary==='paused')await test.pool.query("UPDATE alibaba_conversations SET status='paused' WHERE id=$1",[f.c.id]);
  if(boundary==='input')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[f.c.candidate_id]);
  if(boundary==='spec')assert.equal((await test.call('/api/candidates/'+f.c.candidate_id+'/specs',{material:'Silicone',dimensions:'30 cm',packaging:'Paper box',requirements:'Food contact',requestedQuantity:300,source:'Synthetic incident source change'})).status,201);
  if(boundary==='settings')settings=await row("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'incident-test',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1 RETURNING version,snapshot");
  if(boundary==='go')await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3)",[f.c.candidate_id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot,'caution'))]);
  if(boundary==='stage')await test.pool.query("UPDATE candidates SET stage='parked' WHERE id=$1",[f.c.candidate_id]);
  if(['manual-outbound','binding'].includes(boundary)){
   const message={id:'incident-'+boundary,direction:boundary==='binding'?'inbound':'outbound',body:boundary==='binding'?'Please pay a deposit.':'Manual buyer response',sentAt:new Date().toISOString()};
   await poll(f.c,[f.sent,f.inbound,message]);
  }
  if(['pending','dispatching','outcome_unknown','blocked','cancelled','used-inbound','fourth-round'].includes(boundary)){
   for(let i=0;i<(boundary==='fourth-round'?3:1);i++){
    const id=randomUUID(),initial=(await actions(f.c))[0],basis=boundary==='fourth-round'?randomUUID():f.inboundId;
    if(boundary==='fourth-round')await test.pool.query("INSERT INTO alibaba_messages(id,conversation_id,provider_message_id,direction,body_ciphertext,body_sha256,sent_at,receipt_id) VALUES($1::uuid,$2,$1::text,'inbound',$3,$4,$5,$6)",[basis,f.c.id,encryptSecret(Buffer.from('Earlier quotation'),key,'alibaba-message:'+basis),createHash('sha256').update('Earlier quotation').digest('hex'),new Date(Date.parse(f.sent.sentAt)-1000-i),f.receiptId]);
    await test.pool.query("INSERT INTO alibaba_actions(id,conversation_id,candidate_id,spec_id,input_version,settings_version,kind,inbound_message_id,body_ciphertext,body_sha256,state,started_at,dispatch_task_id,sent_message_id) VALUES($1,$2,$3,NULL,$4,$5,'followup',$6,$7,$8,$9,$10,$11,$12)",[id,f.c.id,f.c.candidate_id,f.c.input_version,f.c.settings_version,basis,encryptSecret(Buffer.from('Synthetic safe comparison request'),key,'alibaba-action:'+id),createHash('sha256').update('Synthetic safe comparison request').digest('hex'),boundary==='used-inbound'||boundary==='fourth-round'?'sent':boundary,['dispatching','outcome_unknown','used-inbound','fourth-round'].includes(boundary)?new Date():null,['dispatching','outcome_unknown','used-inbound','fourth-round'].includes(boundary)?initial.dispatch_task_id:null,boundary==='used-inbound'||boundary==='fourth-round'?initial.sent_message_id:null]);
   }
  }
  if(['queued','delivered','expired-queued','expired-delivered'].includes(boundary)){
   const id=randomUUID(),expired=boundary.startsWith('expired'),stamp=Date.now()-(expired?600000:0);
   const old=await row('SELECT * FROM browser_tasks WHERE result_id=$1',[f.receiptId]);
   const unsigned={...JSON.parse(Buffer.from(old.envelope.payload,'base64url').toString()),id,issuedAt:new Date(stamp).toISOString(),expiresAt:new Date(stamp+300000).toISOString()};
   const envelope=signBrowserTask(unsigned,keys.privateKey);
   await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,state,delivered_at,first_delivered_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,'supplier_thread',$9,$10,$11,$11)",[id,device.id,f.c.candidate_id,f.c.input_version,f.c.settings_version,JSON.stringify(envelope),createHash('sha256').update(envelope.payload).digest('hex'),unsigned.expiresAt,f.c.id,boundary.endsWith('delivered')?'delivered':'queued',boundary.endsWith('delivered')?new Date(stamp+500):null]);
  }
  const before=await incidentState(f);assert.equal((await admitAi(f,overrides)).kind,'not_ready',boundary+' must refuse incident admission');assert.deepEqual(await incidentState(f),before,boundary+' refusal must change nothing');
  await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE conversation_id=$1 AND state IN ('queued','delivered')",[f.c.id]);
  await test.pool.query("UPDATE alibaba_actions SET state='blocked',reason='INCIDENT_TEST_COMPLETED' WHERE conversation_id=$1 AND state IN ('dispatching','outcome_unknown')",[f.c.id]);
 }
 const corrupt=await incidentFixture('evidence');
 for(const defect of ['id','task_id','result_id','device_id','task_hash','body_sha256','signature','source','account','thread','outbound','inbound','reason','negotiation']){
  const before=await incidentState(corrupt);
  const db=incidentConnection(async(sql,args,run)=>{
   const result=await run(),original=result.rows?.[0];
   if(original?.id!==corrupt.receiptId||!original.envelope)return result;
   const r=structuredClone(original);
   if(['id','task_id','result_id','device_id'].includes(defect))r[defect]=randomUUID();
   else if(['task_hash','body_sha256'].includes(defect))r[defect]='0'.repeat(64);
   else if(defect==='signature')r.envelope.signature='A'.repeat(r.envelope.signature.length);
   else if(['source','account','thread','outbound','negotiation'].includes(defect)){
    const task=JSON.parse(Buffer.from(r.envelope.payload,'base64url').toString());
    if(defect==='source')task.request.inputVersion++;
    if(defect==='account')task.request.accountId='999';
    if(defect==='thread')task.request.threadId='wrong-thread';
    if(defect==='outbound')task.request.negotiation.lastOutbound.bodySha256='0'.repeat(64);
    if(defect==='negotiation')delete task.request.negotiation;
    r.envelope=signBrowserTask(task,keys.privateKey);r.task_hash=createHash('sha256').update(r.envelope.payload).digest('hex');
   }else{
    const o=JSON.parse(decryptSecret(r.body_ciphertext,key,'browser-task-result:'+r.id).toString());
    if(defect==='inbound')o.proposal.basedOnInbound.bodySha256='0'.repeat(64);else o.proposal.decision.reason='AI_UNAVAILABLE';
    const {exactPayloadHash}=await import('../packages/security/src/approval-hash.ts');
    r.body_ciphertext=encryptSecret(Buffer.from(JSON.stringify(o)),key,'browser-task-result:'+r.id);r.body_sha256=exactPayloadHash(o);
   }
   return {...result,rows:[r]};
  });
  assert.equal((await admitAi(corrupt,{},db)).kind,'not_ready',defect+' receipt provenance must refuse');assert.deepEqual(await incidentState(corrupt),before);
 }
 for(const failure of ['sign','insert']){
  const f=await incidentFixture('rollback-'+failure),before=await incidentState(f);let reads=0;
  const signer=failure==='sign'?{...signing,get privateKey(){return ++reads===1?keys.privateKey:keys.publicKey;}}:signing;
  const db=failure==='insert'?incidentConnection(async(sql,args,run)=>{if(sql.startsWith('INSERT INTO browser_tasks'))throw Error('synthetic insert failure');return run();}):test.pool;
  await assert.rejects(admitAi(f,{},db,signer));assert.deepEqual(await incidentState(f),before,failure+' failure must roll back the entire admission');
 }
 const racing=await incidentFixture('concurrency'),holder=await test.pool.connect();let racingCalls;
 try{
  await holder.query('BEGIN');await holder.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const pid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  racingCalls=Promise.all([admitAi(racing),admitAi(racing)]);let blocked=0;
  for(let attempt=0;attempt<200&&blocked<2;attempt++)blocked=(await row('SELECT count(*)::int n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid])).n;
  assert.equal(blocked,2,'Both competing admissions must actually wait on the settings transaction');await holder.query('COMMIT');
  const outcomes=await racingCalls;assert.equal(outcomes.filter(r=>r.kind==='queued').length,1);assert.equal(outcomes.filter(r=>r.kind==='not_ready').length,1);
  const restartedIncident=await import('../apps/worker/src/alibaba-scheduler.ts?incident-restart');
  assert.equal((await restartedIncident.queueAlibabaTask(test.pool,{deviceId:device.id,conversationId:racing.c.id,encryptionKey:key,aiRecovery:{inboundMessageId:racing.inboundId,failureReceiptId:racing.receiptId,fixHash:aiFix}},signing)).kind,'not_ready');
  const task=await claim(outcomes.find(r=>r.kind==='queued'));
  const fresh={...racing.inbound,id:'fresh-incident-inbound',sentAt:new Date().toISOString()};
  assert.equal((await submit(task,{...threadObservation(racing.c,[racing.sent,racing.inbound,fresh]),proposal:proposal(fresh)})).status,201);
  assert.equal((await actions(racing.c)).length,2,'Fresh new inbound may pass unchanged result gates');
 }finally{await holder.query('ROLLBACK');if(racingCalls)await racingCalls;holder.release();}
 const staleProposal=await incidentFixture('stale-proposal'),staleIncidentTask=await claim(await admitAi(staleProposal));
 const newerIncidentInbound={...staleProposal.inbound,id:'newer-than-proposal',sentAt:new Date().toISOString()};
 assert.equal((await submit(staleIncidentTask,{...threadObservation(staleProposal.c,[staleProposal.sent,staleProposal.inbound,newerIncidentInbound]),proposal:proposal(staleProposal.inbound)})).status,201);
 assert.equal((await actions(staleProposal.c)).length,1,'Stale proposal anchors cannot create a followup');
 const retained=await retainedSendIncident('valid'),retainedBefore=await incidentState(retained);
 const retainedQueued=await admitAi(retained);assert.equal(retainedQueued.kind,'queued','A confirmed sent action may retain its expired delivered send task without blocking incident admission');
 const retainedAfter=await incidentState(retained),retainedAudit=retainedAfter.audits.find(e=>e.action==='alibaba_ai_incident_admission');
 assert.deepEqual(retainedAfter.actions,retainedBefore.actions);assert.deepEqual(retainedAfter.messages,retainedBefore.messages);
 assert.deepEqual(retainedAfter.tasks.find(t=>t.id===retained.retainedTaskId),retainedBefore.tasks.find(t=>t.id===retained.retainedTaskId));
 assert.equal(retainedAudit.meta.retainedSentTasks.length,1);assert.equal(retainedAudit.meta.retainedSentTasks[0].taskId,retained.retainedTaskId);
 assert.equal(retainedAudit.meta.retainedSentTasks[0].actionId,retainedBefore.actions[0].id);assert.equal(retainedAudit.meta.retainedSentTasks[0].messageId,retainedBefore.actions[0].sent_message_id);
 const confirmedMessage=retainedBefore.messages.find(m=>m.id===retainedBefore.actions[0].sent_message_id);
 assert.equal(retainedAudit.meta.retainedSentTasks[0].receiptId,confirmedMessage.receipt_id);
 const retainedRead=await claim(retainedQueued);assert.ok(payload(retainedRead).request.negotiation);assert.equal((await submit(retainedRead,{...threadObservation(retained.c,[retained.sent,retained.inbound]),proposal:proposal(retained.inbound)})).status,201);
 for(const boundary of ['unexpired','queued','dispatch','hash','time','receipt']){
  const f=await retainedSendIncident(boundary,boundary!=='unexpired',boundary);
  if(boundary==='queued')await test.pool.query("UPDATE browser_tasks SET state='queued' WHERE id=$1",[f.retainedTaskId]);
  const before=await incidentState(f);assert.equal((await admitAi(f)).kind,'not_ready',boundary+' send must refuse');assert.deepEqual(await incidentState(f),before,boundary+' send remains outstanding');
 }
 const cliFixture=await incidentFixture('cli'),cliDirectory=await mkdtemp(path.join(tmpdir(),'forge-ai-incident-')),cliKey=path.join(cliDirectory,'fixture.pem');
 await writeFile(cliKey,keys.privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
 const allowedEnv=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','TEMP','TMP']);
 const cliEnv={...Object.fromEntries(Object.entries(process.env).filter(([name])=>allowedEnv.has(name.toUpperCase()))),APP_ENV:'development',DATABASE_URL:test.databaseUrl,ENCRYPTION_KEY:test.encryptionKeyHex,WEB_ORIGIN:origin,BROWSER_TASKS_ENABLED:'true',BROWSER_SIGNING_KEY_FILE:cliKey};
 const runIncidentCli=(fix=aiFix)=>new Promise(resolve=>execFile(process.execPath,['--import','tsx','scripts/recover-alibaba-ai.ts','--device',device.id,'--conversation',cliFixture.c.id,'--inbound',cliFixture.inboundId,'--failure-receipt',cliFixture.receiptId,'--fix',fix],{windowsHide:true,env:cliEnv,timeout:20000},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
 const workerLease=await test.pool.connect();
 try{
  const before=await incidentState(cliFixture),wrongFix=await runIncidentCli('0'.repeat(64));assert.equal(wrongFix.code,1);assert.equal(wrongFix.stderr.trim(),'ALIBABA_AI_RECOVERY_FIX_MISMATCH');assert.deepEqual(await incidentState(cliFixture),before);
  await workerLease.query("SELECT pg_advisory_lock(hashtext('forge_ops.worker_authority'))");
  const locked=await runIncidentCli();assert.equal(locked.code,1);assert.equal(locked.stderr.trim(),'ALIBABA_AI_RECOVERY_WORKER_RUNNING');assert.deepEqual(await incidentState(cliFixture),before);
  await workerLease.query("SELECT pg_advisory_unlock(hashtext('forge_ops.worker_authority'))");
  const accepted=await runIncidentCli();assert.equal(accepted.code,0,accepted.stderr);const admittedCli=JSON.parse(accepted.stdout);assert.equal(admittedCli.kind,'queued');
  const after=await incidentState(cliFixture),duplicate=await runIncidentCli();assert.equal(duplicate.code,2);assert.equal(JSON.parse(duplicate.stdout).kind,'not_ready');assert.deepEqual(await incidentState(cliFixture),after);
  const task=await claim(admittedCli);assert.ok(payload(task).request.negotiation);assert.equal((await submit(task,{...threadObservation(cliFixture.c,[cliFixture.sent,cliFixture.inbound]),proposal:proposal(cliFixture.inbound)})).status,201);
 }finally{await workerLease.query("SELECT pg_advisory_unlock(hashtext('forge_ops.worker_authority'))");workerLease.release();await unlink(cliKey);await rmdir(cliDirectory);}
 console.log(JSON.stringify({incidentAdmissionChecks:['one persisted allowance with signed negotiation','ordinary retry history unchanged','all refusal paths unchanged','authenticated latest failure receipt','sign and insert rollback','actual concurrent lock wait','restart deduplication','new inbound accepted stale proposal refused','accepted failure remains capped','reconciled expired delivered send preserved and audited','queued/unexpired or unproven send refused','CLI fixed hash and worker lease','CLI real admission and repeat refusal'],externalSupplierCalls:0}));
 const recoveredAi=await negotiationFixture('retry-valid-proposal');await failAi(recoveredAi);
 const validRetry=await scheduledRead(recoveredAi.c,true);
 assert.equal((await submit(validRetry,{...threadObservation(recoveredAi.c,[recoveredAi.sent,recoveredAi.inbound]),proposal:proposal(recoveredAi.inbound)})).status,201);
 assert.equal((await actions(recoveredAi.c)).length,2);assert.equal((await actions(recoveredAi.c))[1].state,'pending');
 // Unsafe recovery boundaries retain attention, action identity, and read-only behavior.
 for(const boundary of ['input','spec','settings','go','pending','unknown','blocked','cancelled','no-outbound','manual-outbound','no-new-inbound','already-answered','business-review']){
  const f=await negotiationFixture('retry-refuse-'+boundary);
  if(['pending','unknown','blocked','cancelled','already-answered'].includes(boundary)){
   await poll(f.c,[f.sent,f.inbound],f.c.id,proposal(f.inbound));
   const a=(await actions(f.c))[1];
   if(boundary==='unknown'){
    const task=await claim(await queue(f.c,a));assert.equal((await start(task)).body.allowed,true);
    assert.equal((await submit(task,threadObservation(f.c,[f.sent,f.inbound],a,'unknown'))).status,201);
   }else if(boundary==='already-answered'){
    const task=await claim(await queue(f.c,a));assert.equal((await start(task)).body.allowed,true);
    // Provider timestamps may precede dispatch by up to 5 seconds; isolate the used-inbound guard.
    const answered={id:'zz-already-answered',direction:'outbound',body:body(a),sentAt:new Date(Date.parse(f.inbound.sentAt)-1).toISOString()};
    assert.equal((await submit(task,threadObservation(f.c,[f.sent,f.inbound,answered],a,'sent'))).status,201);
    assert.equal((await actions(f.c))[1].state,'sent');
   }
   else if(boundary!=='pending')await test.pool.query('UPDATE alibaba_actions SET state=$2 WHERE id=$1',[a.id,boundary]);
   await test.pool.query("UPDATE alibaba_conversations SET status='attention',reason='AI_UNAVAILABLE' WHERE id=$1",[f.c.id]);
  }else if(boundary==='no-new-inbound')await test.pool.query("UPDATE alibaba_conversations SET status='attention',reason='AI_UNAVAILABLE' WHERE id=$1",[f.c.id]);
  else await failAi(f,boundary==='business-review'?'NEGOTIATION_REQUIRES_REVIEW':'AI_UNAVAILABLE');
  if(boundary==='input')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[f.c.candidate_id]);
  if(boundary==='spec')assert.equal((await test.call('/api/candidates/'+f.c.candidate_id+'/specs',{material:'Silicone',dimensions:'30 cm',packaging:'Paper box',requirements:'Food contact',requestedQuantity:300,source:'Synthetic retry source change'})).status,201);
  if(boundary==='go')await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[f.c.candidate_id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot,'caution'))]);
  if(boundary==='settings')settings=await row("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'alibaba-retry-settings-test',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1 RETURNING version,snapshot");
  if(boundary==='no-outbound')await test.pool.query('UPDATE alibaba_actions SET sent_message_id=NULL WHERE conversation_id=$1',[f.c.id]);
  if(boundary==='manual-outbound')await poll(f.c,[f.sent,f.inbound,{id:'manual-after-failure',direction:'outbound',body:'Buyer replied manually.',sentAt:new Date().toISOString()}]);
  const before=await actions(f.c);await scheduleOnly(f.c);await prepareAlibabaActions(test.pool,key);await prepareAlibabaActions(test.pool,key);
  assert.equal(await retryCount(f.c),0,boundary+' must not recover AI');assert.equal((await row('SELECT status FROM alibaba_conversations WHERE id=$1',[f.c.id])).status,'attention');
  assert.deepEqual(await actions(f.c),before,boundary+' must preserve every action');
  const read=await poll(f.c);assert.equal(payload(read).request.negotiation,undefined,boundary+' must not carry AI context');
 }
 const noActions=(await search(await candidate('retry-no-actions')))[0];await poll(noActions);
 await test.pool.query("UPDATE alibaba_conversations SET status='attention',reason='AI_UNAVAILABLE' WHERE id=$1",[noActions.id]);await scheduleOnly(noActions);await prepareAlibabaActions(test.pool,key);
 assert.equal(await retryCount(noActions),0);assert.equal((await actions(noActions)).length,0,'AI failure never creates an initial template');
 // Persisted audits survive a new scheduler module instance (no in-memory retry budget).
 const persisted=await negotiationFixture('persisted-retry-cap');await failAi(persisted);
 const persistedInbound=(await row('SELECT id FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=$2',[persisted.c.id,persisted.inbound.id])).id;
 for(let attempt=0;attempt<2;attempt++)await test.pool.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker:alibaba','alibaba_ai_retry',$1,$2::jsonb)",[persisted.c.id,JSON.stringify({inboundMessageId:persistedInbound})]);
 await scheduleOnly(persisted.c);
 const restarted=await import('../apps/worker/src/alibaba-scheduler.ts?persisted-retry-check');
 assert.equal(await dispatchReads(false,restarted.dispatchAlibabaWork),0);assert.equal(await retryCount(persisted.c),2);
 assert.deepEqual(await row('SELECT status,next_check_at FROM alibaba_conversations WHERE id=$1',[persisted.c.id]),{status:'attention',next_check_at:null});
 const nextInbound={...persisted.inbound,id:'new-inbound-after-capped-ai',sentAt:new Date().toISOString()};
 await poll(persisted.c,[persisted.sent,persisted.inbound,nextInbound]);
 const nextInboundRead=await scheduledRead(persisted.c);assert.ok(payload(nextInboundRead).request.negotiation);
 assert.equal(await retryCount(persisted.c),3,'A newer inbound has its own recovery budget');
 assert.equal((await row("SELECT count(*)::int n FROM audit_events WHERE action='alibaba_ai_retry' AND target=$1 AND meta->>'inboundMessageId'=$2",[persisted.c.id,persistedInbound])).n,2,'Prior inbound budget remains capped');
 assert.equal((await submit(nextInboundRead,{...threadObservation(persisted.c,[persisted.sent,persisted.inbound,nextInbound]),proposal:proposal(nextInbound)})).status,201);
 // A round-limited thread refreshes messages without a fourth follow-up or AI context.
 const limitedBefore=await actions(limited.c),limitedRead=await scheduledRead(limited.c);
 assert.equal(payload(limitedRead).request.negotiation,undefined);assert.equal(payload(limitedRead).request.actionId,undefined);
 const laterInbound={...limited.inbound,id:'round-limit-later-inbound',sentAt:new Date().toISOString()};
 assert.equal((await submit(limitedRead,{...threadObservation(limited.c,[...history,laterInbound]),proposal:proposal(laterInbound)})).status,201);
 assert.deepEqual(await actions(limited.c),limitedBefore);assert.equal((await row('SELECT reason FROM alibaba_conversations WHERE id=$1',[limited.c.id])).reason,'NEGOTIATION_LIMIT_REACHED');
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_messages WHERE conversation_id=$1 AND provider_message_id=$2',[limited.c.id,laterInbound.id])).n,1);await assertCheckIn15Minutes(limited.c);
 await scheduleOnly(limited.c,false);assert.equal(await dispatchReads(),0,'Attention read polling obeys the 15 minute cadence');
 // Only a matching started blocked initial send qualifies for SEND_NOT_CONFIRMED refresh.
 const blockedInitial=(await search(await candidate('blocked-initial-poll')))[0];await poll(blockedInitial);await prepareAlibabaActions(test.pool,key);
 const blockedAction=(await actions(blockedInitial))[0],blockedTask=await claim(await queue(blockedInitial,blockedAction));assert.equal((await start(blockedTask)).body.allowed,true);
 assert.equal((await submit(blockedTask,threadObservation(blockedInitial,[],blockedAction,'not_sent'))).status,201);
 const blockedBefore=await actions(blockedInitial),blockedRead=await scheduledRead(blockedInitial,true);
 assert.equal(payload(blockedRead).request.negotiation,undefined);
 const blockedInbound={id:'blocked-new-inbound',direction:'inbound',body:'Please review our quotation.',sentAt:new Date().toISOString()};
 const possibleSent={id:'blocked-outbound-visible',direction:'outbound',body:body(blockedAction),sentAt:new Date().toISOString()};
 assert.equal((await submit(blockedRead,threadObservation(blockedInitial,[possibleSent,blockedInbound]))).status,201);
 assert.deepEqual(await actions(blockedInitial),blockedBefore,'Read-only blocked polling cannot confirm, rearm, or rewrite a blocked action');
 assert.deepEqual(await row('SELECT status,reason FROM alibaba_conversations WHERE id=$1',[blockedInitial.id]),{status:'attention',reason:'SEND_NOT_CONFIRMED'});await assertCheckIn15Minutes(blockedInitial);
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_messages WHERE conversation_id=$1',[blockedInitial.id])).n,2);
 for(const mismatch of ['unstarted','wrong-reason','followup','other-attention']){
  const f=mismatch==='unstarted'?(await search(await candidate('unstarted-poll')))[0]:mismatch==='followup'?refused.c:blockedInitial;
  if(mismatch==='unstarted'){await poll(f);await prepareAlibabaActions(test.pool,key);await test.pool.query("UPDATE alibaba_actions SET state='blocked',reason='SEND_NOT_CONFIRMED' WHERE conversation_id=$1 AND state='pending'",[f.id]);}
  if(mismatch==='wrong-reason')await test.pool.query("UPDATE alibaba_actions SET reason='NEGOTIATION_CONTEXT_CHANGED' WHERE id=$1",[blockedAction.id]);
  if(mismatch==='followup')await test.pool.query("UPDATE alibaba_actions SET reason='SEND_NOT_CONFIRMED' WHERE id=$1",[refusedAction.id]);
  if(mismatch==='other-attention')await test.pool.query("UPDATE alibaba_actions SET reason='SEND_NOT_CONFIRMED' WHERE id=$1",[blockedAction.id]);
  await test.pool.query("UPDATE alibaba_conversations SET status='attention',reason=$2 WHERE id=$1",[f.id,mismatch==='other-attention'?'BINDING_REQUEST_REQUIRES_REVIEW':'SEND_NOT_CONFIRMED']);
  await scheduleOnly(f);assert.equal(await dispatchReads(),0,mismatch+' is excluded from automatic attention polling');
 }
 // A repeatedly attempted NULL-due conversation cannot monopolize read task creation.
 const failingRead=(await search(await candidate('fair-read-failure')))[0];
 const olderReads=[await negotiationFixture('fair-read-older-a'),await negotiationFixture('fair-read-older-b')];
 const untouchedRead=(await search(await candidate('fair-read-untouched')))[0];
 const insertRead=async(c,issuedAt,expiresAt,deliveredAt=null)=>{
  const id=randomUUID(),request={kind:'supplier_thread',candidateId:c.candidate_id,specId:c.spec_id,inputVersion:c.input_version,settingsVersion:c.settings_version,conversationId:c.id,companyName:c.company_name,companyUrl:c.company_url,productUrl:c.product_url,threadId:c.provider_thread_id,accountId:c.account_id};
  const envelope=signBrowserTask({version:1,id,issuerOrigin:origin,deviceId:device.id,issuedAt:new Date(issuedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString(),request},keys.privateKey);
  await test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,conversation_id,created_at,state,delivered_at,first_delivered_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'supplier_thread',$10,$11,$12,$13,$13)",[id,device.id,c.candidate_id,c.spec_id,c.input_version,c.settings_version,JSON.stringify(envelope),createHash('sha256').update(envelope.payload).digest('hex'),new Date(expiresAt),c.id,new Date(issuedAt),deliveredAt===null?'queued':'delivered',deliveredAt===null?null:new Date(deliveredAt)]);
  return {kind:'queued',taskId:id};
 };
 // A queued read must retain a complete delivery lease after source validation.
 const budgetYounger=[(await search(await candidate('budget-younger-a')))[0],(await search(await candidate('budget-younger-b')))[0]],budgetRead=(await search(await candidate('budget-old-wait')))[0];
 const budgetClock=Date.now(),shortRead=await insertRead(budgetRead,budgetClock-284000,budgetClock+16000);
 const shortBefore=await row('SELECT * FROM browser_tasks WHERE id=$1',[shortRead.taskId]),budgetBefore=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[budgetRead.id]);
 const charges=()=>row(`SELECT (SELECT count(*)::int FROM browser_tasks WHERE first_delivered_at IS NOT NULL) deliveries,
  (SELECT count(*)::int FROM audit_events) audits,(SELECT count(*)::int FROM alibaba_actions) actions,
  (SELECT count(*)::int FROM audit_events WHERE action='alibaba_ai_retry') retries`);
 const chargesBefore=await charges();
 assert.deepEqual(await machine('/api/bridge/tasks/claim',{}),{status:200,body:{kind:'idle'}},'A first read with less than one delivery lease remaining must be cancelled before execution');
 assert.deepEqual(await row('SELECT * FROM browser_tasks WHERE id=$1',[shortRead.taskId]),{...shortBefore,state:'cancelled'},'Cancellation preserves the signed payload, original age and both NULL delivery timestamps');
 assert.deepEqual(await row('SELECT * FROM alibaba_conversations WHERE id=$1',[budgetRead.id]),budgetBefore);
 assert.deepEqual(await charges(),chargesBefore,'Rejected delivery must consume no delivery charge, action, audit or AI retry');
 await scheduleOnly(budgetRead,false);
 await test.pool.query('UPDATE alibaba_conversations SET next_check_at=NULL WHERE id=ANY($1::uuid[])',[[budgetRead.id,...budgetYounger.map(c=>c.id)]]);
 assert.equal(await dispatchReads(),2);
 const freshBudget=await row("SELECT * FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[budgetRead.id]);
 assert.ok(freshBudget,'The original waiting age must win a replacement slot ahead of younger conversations');assert.notEqual(freshBudget.id,shortRead.taskId);
 assert.equal((await row("SELECT count(*)::int n FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[budgetYounger[1].id])).n,0,'The two queued cap still applies to replacement work');
 const oldRequest=JSON.parse(Buffer.from(shortBefore.envelope.payload,'base64url').toString('utf8')),freshRequest=JSON.parse(Buffer.from(freshBudget.envelope.payload,'base64url').toString('utf8'));
 assert.deepEqual(freshRequest.request,oldRequest.request,'Reissue retains exact conversation and source identity');
 assert.equal(Date.parse(freshRequest.expiresAt)-Date.parse(freshRequest.issuedAt),300000,'Reissue uses the existing signed five-minute lifetime');
 const freshClaim=await claim({kind:'queued',taskId:freshBudget.id});
 const freshDelivery=await row('SELECT first_delivered_at,delivered_at,extract(epoch FROM(expires_at-delivered_at)) remaining FROM browser_tasks WHERE id=$1',[freshBudget.id]);
 assert.ok(Number(freshDelivery.remaining)>150);assert.deepEqual(freshDelivery.first_delivered_at,freshDelivery.delivered_at);
 assert.equal((await submit(freshClaim,threadObservation(budgetRead))).status,201);
 const youngerQueued=await row("SELECT id FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[budgetYounger[0].id]);
 assert.equal((await submit(await claim({kind:'queued',taskId:youngerQueued.id}),threadObservation(budgetYounger[0]))).status,201);
 // Cross the 150-second boundary during source locking, using the database clock at the real atomic UPDATE.
 const lockBudget=(await search(await candidate('budget-source-lock')))[0],lockClock=Date.now(),lockRead=await insertRead(lockBudget,lockClock-148000,lockClock+152000);
 const claimConnect=test.pool.connect.bind(test.pool);let delayedSourceLocks=0;
 test.pool.connect=(...args)=>{
  if(typeof args[0]==='function')return claimConnect(...args);
  return claimConnect(...args).then(connection=>{
   const query=connection.query,release=connection.release;
   connection.query=async function(...queryArgs){
    if(typeof queryArgs[0]==='string'&&queryArgs[0].startsWith('SELECT c.* FROM alibaba_conversations c WHERE id=$1')&&queryArgs[1]?.[0]===lockBudget.id){
     delayedSourceLocks++;
     assert.equal((await query.call(this,"SELECT expires_at>clock_timestamp()+interval '150 seconds' enough FROM browser_tasks WHERE id=$1",[lockRead.taskId])).rows[0].enough,true,'Selected task starts with a complete lease');
     await query.call(this,"SELECT pg_sleep(GREATEST(0,extract(epoch FROM(expires_at-clock_timestamp()))-149.5)) FROM browser_tasks WHERE id=$1",[lockRead.taskId]);
    }
    return query.apply(this,queryArgs);
   };
   connection.release=function(...args){connection.query=query;connection.release=release;return release.apply(connection,args);};
   return connection;
  });
 };
 let lateBudgetClaim;
 try{lateBudgetClaim=await machine('/api/bridge/tasks/claim',{});}finally{test.pool.connect=claimConnect;}
 assert.equal(delayedSourceLocks,1);assert.deepEqual(lateBudgetClaim,{status:200,body:{kind:'idle'}},'Source-lock delay cannot deliver a read with an incomplete lease');
 assert.deepEqual(await row('SELECT state,first_delivered_at,delivered_at FROM browser_tasks WHERE id=$1',[lockRead.taskId]),{state:'cancelled',first_delivered_at:null,delivered_at:null});
 const attemptClock=Date.now(),recoveryFirstDelivery=new Date(attemptClock-151000),expiringRead=await claim(await insertRead(failingRead,attemptClock-200000,attemptClock+1500,recoveryFirstDelivery.getTime()));
 const recoveredLease=await row('SELECT first_delivered_at,delivered_at,expires_at FROM browser_tasks WHERE id=$1',[expiringRead.taskId]);
 assert.deepEqual(recoveredLease.first_delivered_at,recoveryFirstDelivery,'Recovery preserves the original delivery charge');
 assert.ok(recoveredLease.delivered_at>recoveryFirstDelivery&&recoveredLease.expires_at-recoveredLease.delivered_at<150000,'An already-delivered read still recovers after the existing 150-second lease, even near expiry');
 console.log(JSON.stringify({deliveryBudgetChecks:['first read requires full150-second lease','no cancelled delivery/retry/audit charge','original waiting age and source preserved','same-source five-minute reissue beats younger','adequate first read delivered','final UPDATE rejects source-lock deadline crossing','existing delivered recovery below150seconds preserved'],externalSupplierCalls:0}));
 await new Promise(resolve=>setTimeout(resolve,1600));
 await scheduleOnly(failingRead,false);
 await test.pool.query('UPDATE alibaba_conversations SET next_check_at=NULL WHERE id=ANY($1::uuid[])',[[failingRead.id,untouchedRead.id]]);
 await test.pool.query("UPDATE alibaba_conversations SET next_check_at=clock_timestamp()-interval '1 hour' WHERE id=ANY($1::uuid[])",[olderReads.map(f=>f.c.id)]);
 const queuedReadIds=async()=>(await test.pool.query("SELECT conversation_id FROM browser_tasks WHERE task_kind='supplier_thread' AND state='queued' AND expires_at>clock_timestamp() ORDER BY conversation_id")).rows.map(r=>r.conversation_id);
 assert.equal(await dispatchReads(),2);
 assert.deepEqual(await queuedReadIds(),olderReads.map(f=>f.c.id).sort(),'Older due conversations must receive tasks before the recently attempted NULL-due conversation or a newer untouched conversation');
 assert.equal(await dispatchReads(),0,'Two live queued reads fill the scheduler cap');
 for(const f of olderReads){
  const queued=await row("SELECT id FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[f.c.id]);
  const read=await claim({kind:'queued',taskId:queued.id});
  assert.equal((await submit(read,threadObservation(f.c,[f.sent]))).status,201);
 }
 assert.equal(await dispatchReads(),2);
 assert.deepEqual(await queuedReadIds(),[failingRead.id,untouchedRead.id].sort(),'The untouched new conversation must receive its next waiting turn');
 assert.equal((await row('SELECT state FROM browser_tasks WHERE id=$1',[expiringRead.taskId])).state,'cancelled','Expired delivered reads are replaced without resetting conversation fairness');
 assert.equal(await dispatchReads(),0,'Repeated dispatch cannot exceed two queued reads');
 let retriedFailure;
 for(let i=0;i<2;i++){
  const read=await machine('/api/bridge/tasks/claim',{});assert.equal(read.status,200);assert.equal(read.body.kind,'task');
  if(payload(read.body).request.conversationId===failingRead.id)retriedFailure=read.body;
  else assert.equal((await submit(read.body,threadObservation(untouchedRead))).status,201);
 }
 assert.ok(retriedFailure);await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[retriedFailure.taskId]);
 await test.pool.query("UPDATE alibaba_conversations SET next_check_at=clock_timestamp()-interval '1 hour' WHERE id=ANY($1::uuid[])",[olderReads.map(f=>f.c.id)]);
 assert.equal(await dispatchReads(),2);
 assert.deepEqual(await queuedReadIds(),olderReads.map(f=>f.c.id).sort(),'A second failed attempt again rotates behind older eligible reads');
 for(const f of olderReads){
  const queued=await row("SELECT id FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[f.c.id]);
  assert.equal((await submit(await claim({kind:'queued',taskId:queued.id}),threadObservation(f.c,[f.sent]))).status,201);
 }
 // Never-delivered expiry/re-signing retains the original waiting age across restarts.
 const waitingReads=[(await search(await candidate('fair-unclaimed-middle')))[0],(await search(await candidate('fair-unclaimed-newer')))[0],(await search(await candidate('fair-unclaimed-oldest')))[0]];
 const ageClock=Date.now();
 for(const [c,age] of [[waitingReads[0],1800000],[waitingReads[1],1200000],[waitingReads[2],3600000],[waitingReads[2],600000]]){
  const expired=await insertRead(c,ageClock-age,ageClock-age+300000);
  await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[expired.taskId]);
 }
 await scheduleOnly(waitingReads[0],false);
 await test.pool.query('UPDATE alibaba_conversations SET next_check_at=NULL WHERE id=ANY($1::uuid[])',[waitingReads.map(c=>c.id)]);
 const resumedScheduler=await import('../apps/worker/src/alibaba-scheduler.ts?persisted-read-fairness');
 assert.equal(await dispatchReads(false,resumedScheduler.dispatchAlibabaWork),2);
 assert.deepEqual(await queuedReadIds(),[waitingReads[2].id,waitingReads[0].id].sort(),'Never-delivered re-signing must retain the oldest original task age, not its latest creation or conversation age');
 assert.equal(await dispatchReads(),0);
 for(const c of [waitingReads[2],waitingReads[0]]){
  const queued=await row("SELECT id FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[c.id]);
  assert.equal((await submit(await claim({kind:'queued',taskId:queued.id}),threadObservation(c))).status,201);
 }
 assert.equal(await dispatchReads(),1);
 assert.deepEqual(await queuedReadIds(),[waitingReads[1].id],'The remaining untouched read must receive a turn after the older waiting reads');
 const finalWaiting=await row("SELECT id FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[waitingReads[1].id]);
 assert.equal((await submit(await claim({kind:'queued',taskId:finalWaiting.id}),threadObservation(waitingReads[1]))).status,201);
 // Retire only untouched duplicate-thread conflicts and refill from their accepted source receipt.
 const duplicateSource=await candidate('duplicate-retirement'),duplicates=await search(duplicateSource,5),retiring=duplicates[0];
 await poll(retiring,[],c.id);
 const retirementBefore=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[retiring.id]),ownerActionsBefore=await actions(c);
 const lateRetiredRead=await claim(await queue(retiring));
 await scheduleOnly(retiring,false);await dispatchReads();
 const retired=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[retiring.id]);
 assert.deepEqual(retired,{...retirementBefore,status:'paused'},'Only an untouched ownership conflict retires; its original history remains unchanged');
 const replacementRows=(await test.pool.query('SELECT * FROM alibaba_conversations WHERE candidate_id=$1 ORDER BY created_at,id',[duplicateSource.id])).rows;
 assert.equal(replacementRows.length,4);assert.equal(replacementRows.filter(row=>row.status!=='paused').length,3,'Exactly one active slot is replaced');
 const replacement=replacementRows.find(row=>!duplicates.some(original=>original.id===row.id));
 assert.ok(replacement);assert.equal(replacement.source_receipt_id,retiring.source_receipt_id,'Replacement must replay the same accepted search receipt');
 assert.deepEqual(await actions(c),ownerActionsBefore,'Duplicate retirement must not rewrite or rearm the existing owner actions');
 assert.equal((await queue(retiring)).kind,'not_ready','Retired history cannot receive another browser task');
 assert.deepEqual(await submit(lateRetiredRead,threadObservation(retiring)),{status:400,body:{code:'INVALID_RESULT'}},'A delivered read cannot revive retired history');
 assert.equal((await row('SELECT count(*)::int n FROM browser_task_results WHERE task_id=$1',[lateRetiredRead.taskId])).n,0,'Rejected late results must not insert receipts');
 assert.deepEqual(await row('SELECT * FROM alibaba_conversations WHERE id=$1',[retiring.id]),retired);
 for(const patch of ["status='queued'","reason=NULL","account_id='123',provider_thread_id='replacement-thread'","next_check_at=clock_timestamp()","company_name='rewritten'"]){
  await assert.rejects(test.pool.query('UPDATE alibaba_conversations SET '+patch+' WHERE id=$1',[retiring.id]),/immutable|retired/i);
 }
 const replacementTask=await row("SELECT id FROM browser_tasks WHERE conversation_id=$1 AND state='queued'",[replacement.id]);
 assert.ok(replacementTask);assert.equal((await submit(await claim({kind:'queued',taskId:replacementTask.id}),threadObservation(replacement))).status,201);
 const duplicateWorkspace=(await test.call('/api/candidates/'+duplicateSource.id+'/contact')).body.website;
 assert.equal(duplicateWorkspace.status,'queued');assert.equal(duplicateWorkspace.reason,null);assert.equal(duplicateWorkspace.conversations.length,4);
 assert.equal(duplicateWorkspace.conversations.find(row=>row.id===retiring.id).status,'paused','Detail must retain the retired history');
 const projected=(await test.call('/api/candidates')).body.candidates.find(row=>row.id===duplicateSource.id);
 assert.equal(projected.nextAction.kind,'automatic');assert.equal(projected.blockedReason,null,'Historical conflict must not block healthy replacements');
 const insertCompany=(db,source,key=randomUUID(),status='queued',reason=null)=>db.query(`INSERT INTO alibaba_conversations(candidate_id,spec_id,input_version,settings_version,company_key,company_name,company_url,product_url,source_receipt_id,status,reason)
  SELECT candidate_id,spec_id,input_version,settings_version,$2,company_name,company_url,product_url,source_receipt_id,$3,$4 FROM alibaba_conversations WHERE id=$1 RETURNING *`,[source.id,key,status,reason]);
 await assert.rejects(insertCompany(test.pool,replacement),/company limit/i,'Retired history exempts exactly one slot, never a fourth active company');
 const insertChild=(db,parent,kind)=>{
  const id=randomUUID(),text='Synthetic retirement boundary fixture',cipher=encryptSecret(Buffer.from(text),key,'alibaba-'+kind+':'+id),hash=createHash('sha256').update(text).digest('hex');
  return kind==='action'
   ?db.query("INSERT INTO alibaba_actions(id,conversation_id,candidate_id,spec_id,input_version,settings_version,kind,body_ciphertext,body_sha256) SELECT $2,id,candidate_id,spec_id,input_version,settings_version,'initial',$3,$4 FROM alibaba_conversations WHERE id=$1",[parent.id,id,cipher,hash])
   :db.query("INSERT INTO alibaba_messages(id,conversation_id,provider_message_id,direction,body_ciphertext,body_sha256,sent_at,receipt_id) SELECT $2::uuid,id,$2::text,'inbound',$3,$4,clock_timestamp(),source_receipt_id FROM alibaba_conversations WHERE id=$1",[parent.id,id,cipher,hash]);
 };
 for(const kind of ['action','message'])await assert.rejects(insertChild(test.pool,retired,kind),/retired/i);
 // Retired and active companies both remain globally used, even in new authenticated searches.
 const globalSource=await candidate('globally-used'),globallyUsed=await search(globalSource,3,[retired,replacement].map((r,i)=>({companyName:r.company_name,companyUrl:r.company_url,productName:'Synthetic reused '+i,productUrl:r.product_url,pageText:r.company_name+' Synthetic reused '+i})).concat({companyName:'Synthetic unused',companyUrl:'https://unused'+globalSource.id.replaceAll('-','')+'.en.alibaba.com/',productName:'Synthetic unused product',productUrl:'https://www.alibaba.com/product-detail/unused-'+globalSource.id+'.html',pageText:'Synthetic unused Synthetic unused product'}));
 assert.equal(globallyUsed.length,1,'Stored company history is skipped globally while unused companies are registered');
 for(const used of [retired,replacement])await assert.rejects(insertCompany(test.pool,globallyUsed[0],used.company_key),/already used/i);
 await assert.rejects(insertCompany(test.pool,globallyUsed[0],randomUUID(),'paused','THREAD_OWNERSHIP_CONFLICT'),/existing attention/i,'A direct pre-retired insert cannot fabricate exempt history');
 // An old queued task becomes unclaimable, and an exhausted source clears only historical blocking.
 const emptySource=await candidate('retired-only'),empty=(await search(emptySource))[0];await poll(empty,[],c.id);
 const obsolete=await queue(empty);assert.equal(obsolete.kind,'queued');
 await scheduleOnly(empty,false);await dispatchReads();
 const afterRetiredClaim=await machine('/api/bridge/tasks/claim',{});assert.equal(afterRetiredClaim.status,200);assert.notEqual(afterRetiredClaim.body.taskId,obsolete.taskId);
 assert.equal((await row('SELECT state FROM browser_tasks WHERE id=$1',[obsolete.taskId])).state,'cancelled','Queued retired reads must be cancelled by the normal claim gate');
 await assert.rejects(insertRead(empty,Date.now(),Date.now()+300000),/retired/i,'Direct task insertion must also reject retired history');
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[emptySource.id])).n,1);
 const emptyWorkspace=(await test.call('/api/candidates/'+emptySource.id+'/contact')).body.website;
 assert.equal(emptyWorkspace.status,'searching');assert.equal(emptyWorkspace.reason,null);assert.equal(emptyWorkspace.conversations.length,1);
 const emptyCandidate=await row('SELECT stage,blocked_reason FROM candidates WHERE id=$1',[emptySource.id]);assert.deepEqual(emptyCandidate,{stage:'sourcing',blocked_reason:null});
 // Other paused/attention rows, including a NULL reason, still consume the active cap.
 const capRows=await search(await candidate('ordinary-paused-cap'),3);
 await test.pool.query("UPDATE alibaba_conversations SET status='paused',reason=NULL WHERE id=$1",[capRows[0].id]);
 await test.pool.query("UPDATE alibaba_conversations SET status='attention',reason='OTHER_REVIEW' WHERE id=$1",[capRows[1].id]);
 await assert.rejects(insertCompany(test.pool,capRows[0]),/company limit/i);
 const unchanged=[];
 for(const kind of ['bound','action','message','reason','input','spec','go']){
  const parent=(await search(await candidate('nonretirable-'+kind),4))[0];
  await poll(parent,[],c.id);
  if(kind==='bound')await test.pool.query("UPDATE alibaba_conversations SET account_id='123456789',provider_thread_id=$2 WHERE id=$1",[parent.id,'bound-'+parent.id]);
  else if(kind==='action'||kind==='message')await insertChild(test.pool,parent,kind);
  else if(kind==='reason')await test.pool.query("UPDATE alibaba_conversations SET reason='OTHER_REVIEW' WHERE id=$1",[parent.id]);
  else if(kind==='input')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[parent.candidate_id]);
  else if(kind==='spec')assert.equal((await test.call('/api/candidates/'+parent.candidate_id+'/specs',{material:'Silicone',dimensions:'30 cm',packaging:'Paper box',requirements:'Food contact',requestedQuantity:300,source:'Synthetic retirement source change'})).status,201);
  else await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[parent.candidate_id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot,'caution'))]);
  unchanged.push({kind,parent,before:await row('SELECT * FROM alibaba_conversations WHERE id=$1',[parent.id]),actions:await actions(parent)});
  if(['action','message','reason'].includes(kind))await assert.rejects(test.pool.query("UPDATE alibaba_conversations SET status='paused',reason='THREAD_OWNERSHIP_CONFLICT' WHERE id=$1",[parent.id]),/retirement rejected/i);
 }
 await scheduleOnly(retired,false);
 for(const f of unchanged)f.before=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[f.parent.id]);
 await dispatchReads();
 for(const f of unchanged){
  assert.deepEqual(await row('SELECT * FROM alibaba_conversations WHERE id=$1',[f.parent.id]),f.before,f.kind+' must not retire');
  assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[f.parent.candidate_id])).n,3,f.kind+' must not create replacements');assert.deepEqual(await actions(f.parent),f.actions);
 }
 // Observe a real PostgreSQL lock wait before committing the winner; no timing sleeps establish the race.
 const serialized=async(first,second,expected)=>{
  const a=await test.pool.connect(),b=await test.pool.connect();let pending;
  try{
   await a.query('BEGIN');await b.query('BEGIN');
   const aid=(await a.query('SELECT pg_backend_pid() pid')).rows[0].pid,bid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   await first(a);pending=second(b).then(()=>null,error=>error);
   let blocked=false;
   for(let attempt=0;attempt<200&&!blocked;attempt++)blocked=(await row('SELECT $1::int=ANY(pg_blocking_pids($2)) blocked',[aid,bid])).blocked;
   assert.equal(blocked,true,'The competing connection must actually wait on the first transaction');
   await a.query('COMMIT');assert.match(String(await pending),expected);
  }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
 };
 const raceA=(await search(await candidate('global-race-a')))[0],raceB=(await search(await candidate('global-race-b')))[0],raceKey='race-'+randomUUID();
 await serialized(db=>insertCompany(db,raceA,raceKey),db=>insertCompany(db,raceB,raceKey),/already used/i);
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE company_key=$1',[raceKey])).n,1);
 const raceCap=(await search(await candidate('cap-race')))[0];
 await serialized(async db=>{await insertCompany(db,raceCap);await insertCompany(db,raceCap);},db=>insertCompany(db,raceCap),/company limit/i);
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[raceCap.candidate_id])).n,3);
 for(const kind of ['action','message']){
  const raceRetired=(await search(await candidate('retirement-child-race-'+kind)))[0];await poll(raceRetired,[],c.id);
  await serialized(async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");await db.query('SELECT id FROM candidates WHERE id=$1 FOR UPDATE',[raceRetired.candidate_id]);
   await db.query("UPDATE alibaba_conversations SET status='paused' WHERE id=$1",[raceRetired.id]);
  },db=>insertChild(db,raceRetired,kind),/retired/i);
  assert.equal((await row('SELECT alibaba_conversation_retired(c) retired FROM alibaba_conversations c WHERE id=$1',[raceRetired.id])).retired,true);
 }
 // Seed the historical cross-candidate duplicate under its original guard, then restore current enforcement.
 const legacyGuard=(await readFile(new URL('../packages/db/sql/0051_alibaba_conversations.sql',import.meta.url),'utf8')).match(/CREATE FUNCTION alibaba_conversation_guard\(\)[\s\S]*?END; \$\$;/)[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 const currentGuard=(await row("SELECT pg_get_functiondef('alibaba_conversation_guard()'::regprocedure) definition")).definition;
 const queuedDuplicate=async(label,peer='bound')=>{
  // Unstarted queued sends from earlier fixtures would otherwise take the claim ahead of this fixture's search.
  await test.pool.query("UPDATE browser_tasks t SET state='cancelled' WHERE device_id=$1 AND ((task_kind='supplier_thread' AND state IN ('queued','delivered')) OR (task_kind='supplier_send' AND state='queued' AND NOT EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.dispatch_task_id=t.id AND a.started_at IS NOT NULL)))",[device.id]);
  const parent=await candidate('queued-duplicate-'+label),siblings=await search(parent,4),target=siblings[0],other=await candidate('queued-owner-'+label);
  await search(other,1,[{companyName:target.company_name,companyUrl:target.company_url,productName:'Synthetic legacy shared company',productUrl:target.product_url,pageText:target.company_name+' Synthetic legacy shared company'}]);
  const source=await row("SELECT result_id FROM browser_tasks WHERE candidate_id=$1 AND task_kind='supplier_search' AND state='completed' ORDER BY created_at DESC LIMIT 1",[other.id]);
  const db=await test.pool.connect();let owner;
  try{
   await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");await db.query(legacyGuard);
   owner=(await db.query(`INSERT INTO alibaba_conversations(candidate_id,spec_id,input_version,settings_version,company_key,company_name,company_url,product_url,source_receipt_id)
    SELECT $2,NULL,$3,$4,CASE WHEN $6 THEN 'different-'||company_key ELSE company_key END,company_name,CASE WHEN $6 THEN replace(company_url,'https://','https://different-') ELSE company_url END,product_url,$5 FROM alibaba_conversations WHERE id=$1 RETURNING *`,[target.id,other.id,other.input_version,settings.version,source.result_id,peer==='distinct'])).rows[0];
   await db.query(currentGuard);await db.query('COMMIT');
  }finally{await db.query('ROLLBACK');db.release();}
  assert.equal((await row("SELECT pg_get_functiondef('alibaba_conversation_guard()'::regprocedure) definition")).definition,currentGuard,'Final guard is restored before exercising scheduler behavior');
  if(peer==='retired'){
   await test.pool.query("UPDATE alibaba_conversations SET status='attention',reason='THREAD_OWNERSHIP_CONFLICT' WHERE id=$1",[owner.id]);
   await test.pool.query("UPDATE alibaba_conversations SET status='paused' WHERE id=$1",[owner.id]);
  }else if(peer!=='unbound'){
   await poll(owner);await insertChild(test.pool,owner,'action');
   await test.pool.query("UPDATE alibaba_conversations SET status='awaiting_reply' WHERE id=$1",[owner.id]);
  }
  return {parent,target,owner,siblings};
 };
 const legacy=await queuedDuplicate('positive'),lateLegacyRead=await claim(await queue(legacy.target));
 await scheduleOnly(legacy.target,false);
 const legacyBefore=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[legacy.target.id]),legacyOwnerBefore=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[legacy.owner.id]),legacyOwnerActions=await actions(legacy.owner);
 await dispatchReads();
 assert.deepEqual(await row('SELECT * FROM alibaba_conversations WHERE id=$1',[legacy.target.id]),{...legacyBefore,status:'paused',reason:'THREAD_OWNERSHIP_CONFLICT'},'A legacy untouched queued duplicate must retire without waiting for another browser capture');
 const legacyRows=(await test.pool.query('SELECT * FROM alibaba_conversations WHERE candidate_id=$1 ORDER BY created_at,id',[legacy.parent.id])).rows;
 assert.equal(legacyRows.length,4);assert.equal(legacyRows.filter(r=>r.status!=='paused').length,3);
 const legacyReplacement=legacyRows.find(r=>!legacy.siblings.some(s=>s.id===r.id));assert.ok(legacyReplacement);assert.equal(legacyReplacement.source_receipt_id,legacy.target.source_receipt_id);
 assert.deepEqual(await row('SELECT * FROM alibaba_conversations WHERE id=$1',[legacy.owner.id]),legacyOwnerBefore);assert.deepEqual(await actions(legacy.owner),legacyOwnerActions);
 assert.equal((await actions(legacy.target)).length,0);assert.equal((await row('SELECT count(*)::int n FROM alibaba_messages WHERE conversation_id=$1',[legacy.target.id])).n,0);
 assert.deepEqual(await submit(lateLegacyRead,threadObservation(legacy.target)),{status:400,body:{code:'INVALID_RESULT'}});
 assert.equal((await row('SELECT count(*)::int n FROM browser_task_results WHERE task_id=$1',[lateLegacyRead.taskId])).n,0);
 assert.equal((await queue(legacy.target)).kind,'not_ready');await dispatchReads();
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[legacy.parent.id])).n,4,'Repeated recovery must not create another replacement');
 await assert.rejects(insertCompany(test.pool,legacy.owner,legacy.target.company_key),/already used|duplicate key/i);
 const queuedLegacy=await queuedDuplicate('queued-task'),queuedLegacyRead=await queue(queuedLegacy.target);assert.equal(queuedLegacyRead.kind,'queued');
 await scheduleOnly(queuedLegacy.target,false);await dispatchReads();await machine('/api/bridge/tasks/claim',{});
 assert.equal((await row('SELECT state FROM browser_tasks WHERE id=$1',[queuedLegacyRead.taskId])).state,'cancelled','Old queued duplicate reads must be cancelled by the existing claim guard');
 await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE device_id=$1 AND task_kind='supplier_thread' AND state IN ('queued','delivered')",[device.id]);
 for(const defect of ['distinct','unbound','retired','action','message','bound','reason','input','spec','go']){
  const f=await queuedDuplicate('refuse-'+defect,['distinct','unbound','retired'].includes(defect)?defect:'bound');
  if(defect==='unbound'){
   await assert.rejects(test.pool.query("UPDATE alibaba_conversations SET account_id='123456789' WHERE id=$1",[f.owner.id]),/check constraint/i,'A partially bound owner is forbidden by the existing DB invariant');
   await assert.rejects(insertCompany(test.pool,f.target,f.target.company_key),/duplicate key/i,'A second same-candidate company peer is forbidden by the existing unique constraint');
  }
  if(defect==='action'||defect==='message')await insertChild(test.pool,f.target,defect);
  if(defect==='bound')await poll(f.target);
  if(defect==='reason')await test.pool.query("UPDATE alibaba_conversations SET reason='OTHER_REVIEW' WHERE id=$1",[f.target.id]);
  if(defect==='input')await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1',[f.parent.id]);
  if(defect==='spec')assert.equal((await test.call('/api/candidates/'+f.parent.id+'/specs',{material:'Silicone',dimensions:'30 cm',packaging:'Paper box',requirements:'Food contact',requestedQuantity:300,source:'Synthetic queued duplicate source change'})).status,201);
  if(defect==='go')await test.pool.query("INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload) VALUES($1,$2,'api_validation','pass',$3::jsonb)",[f.parent.id,settings.version,JSON.stringify(orderValidationFixture(settings.snapshot,'caution'))]);
  await scheduleOnly(f.target,false);const before=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[f.target.id]);
  await dispatchReads();
  const after=await row('SELECT c.*,alibaba_conversation_retired(c) retired FROM alibaba_conversations c WHERE id=$1',[f.target.id]);
  assert.equal(after.retired,false,defect+' must not enter duplicate retirement');
  assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[f.parent.id])).n,3,defect+' cannot free a replacement slot');
  for(const field of ['id','candidate_id','source_receipt_id','company_key','company_url','product_url','spec_id','input_version','settings_version','account_id','provider_thread_id','created_at'])assert.deepEqual(after[field],before[field],defect+' preserves '+field);
  if(!['input','spec','go'].includes(defect)){delete after.retired;assert.deepEqual(after,before,defect+' remains unchanged');}
 }
 for(const defect of ['source-candidate','reciprocal-result']){
  const f=await queuedDuplicate(defect),other=await candidate('wrong-'+defect),db=await test.pool.connect();let target;
  try{
   await db.query('BEGIN');await db.query(legacyGuard);
   target=(await db.query(`INSERT INTO alibaba_conversations(candidate_id,spec_id,input_version,settings_version,company_key,company_name,company_url,product_url,source_receipt_id)
    SELECT $2,NULL,$3,$4,company_key,company_name,company_url,product_url,source_receipt_id FROM alibaba_conversations WHERE id=$1 RETURNING *`,[f.target.id,other.id,other.input_version,settings.version])).rows[0];
   await db.query(currentGuard);await db.query('COMMIT');
  }finally{await db.query('ROLLBACK');db.release();}
  if(defect==='reciprocal-result'){
   const id=randomUUID(),issued=Date.now(),envelope=signBrowserTask({version:1,id,issuerOrigin:origin,deviceId:device.id,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(issued+300000).toISOString(),request:{kind:'supplier_search',candidateId:other.id,specId:null,inputVersion:other.input_version,settingsVersion:settings.version,query:other.keyword_display}},keys.privateKey);
   await assert.rejects(test.pool.query("INSERT INTO browser_tasks(id,device_id,candidate_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,state,result_id,delivered_at,first_delivered_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'supplier_search','completed',$9,clock_timestamp(),clock_timestamp())",[id,device.id,other.id,other.input_version,settings.version,JSON.stringify(envelope),createHash('sha256').update(envelope.payload).digest('hex'),new Date(issued+300000),target.source_receipt_id]),/browser_task_result_identity/,'The existing reciprocal result FK rejects a receipt owned by another task');
  }
  await scheduleOnly(target,false);const before=await row('SELECT * FROM alibaba_conversations WHERE id=$1',[target.id]);await dispatchReads();
  assert.deepEqual(await row('SELECT * FROM alibaba_conversations WHERE id=$1',[target.id]),before,defect+' cannot classify from another task or candidate receipt');
  assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[other.id])).n,1);
 }
 const wrapScheduler=intercept=>({query:test.pool.query.bind(test.pool),connect:async()=>{
  const db=await test.pool.connect(),pid=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  return {query:(sql,args)=>intercept(sql,args,()=>db.query(sql,args),pid),release:()=>db.release()};
 }});
 const rollbackDuplicate=await queuedDuplicate('rollback');await scheduleOnly(rollbackDuplicate.target,false);
 const rollbackBefore=(await test.pool.query('SELECT * FROM alibaba_conversations WHERE candidate_id=$1 ORDER BY id',[rollbackDuplicate.parent.id])).rows;
 let classified=false;
 await assert.rejects(dispatchAlibabaWork(wrapScheduler(async(sql,args,next)=>{
  const result=await next();if(sql.includes("SET status='attention',reason='THREAD_OWNERSHIP_CONFLICT'")&&result.rowCount){classified=true;throw Error('QUEUED_DUPLICATE_ROLLBACK');}return result;
 }),signing,key),/QUEUED_DUPLICATE_ROLLBACK/);
 assert.equal(classified,true);assert.deepEqual((await test.pool.query('SELECT * FROM alibaba_conversations WHERE candidate_id=$1 ORDER BY id',[rollbackDuplicate.parent.id])).rows,rollbackBefore,'Failure after classification must roll back attention and replacement together');
 await dispatchReads();
 for(const kind of ['action','message']){
  const f=await queuedDuplicate('classification-race-'+kind);await scheduleOnly(f.target,false);
  let reached,release;const entered=new Promise(resolve=>{reached=resolve;}),continueRecovery=new Promise(resolve=>{release=resolve;});
  const recovering=dispatchAlibabaWork(wrapScheduler(async(sql,args,next,pid)=>{
   const result=await next();if(sql.includes("SET status='attention',reason='THREAD_OWNERSHIP_CONFLICT'")&&result.rowCount){reached(pid);await continueRecovery;}return result;
  }),signing,key);
  const recoveryPid=await entered,child=await test.pool.connect();let competing;
  try{
   await child.query('BEGIN');const childPid=(await child.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   competing=insertChild(child,f.target,kind).then(()=>null,error=>error);
   let blocked=false;for(let i=0;i<200&&!blocked;i++)blocked=(await row('SELECT $1::int=ANY(pg_blocking_pids($2)) blocked',[recoveryPid,childPid])).blocked;
   assert.equal(blocked,true,'Child insertion must actually wait while queued classification holds the settings lock');
   release();await recovering;assert.match(String(await competing),/retired/i);
   assert.equal((await row('SELECT alibaba_conversation_retired(c) retired FROM alibaba_conversations c WHERE id=$1',[f.target.id])).retired,true);
  }finally{release();await recovering;await child.query('ROLLBACK');if(competing)await competing;child.release();}
 }
 const childFirst=await queuedDuplicate('child-first'),childDb=await test.pool.connect();await scheduleOnly(childFirst.target,false);let childRecovery;
 try{
  await childDb.query('BEGIN');await insertChild(childDb,childFirst.target,'message');
  const childPid=(await childDb.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  let reached;const entered=new Promise(resolve=>{reached=resolve;});
  childRecovery=dispatchAlibabaWork(wrapScheduler((sql,args,next,pid)=>{if(sql.includes("pg_advisory_xact_lock(hashtext('forge.settings'))"))reached(pid);return next();}),signing,key);
  const recoveryPid=await entered;let blocked=false;for(let i=0;i<200&&!blocked;i++)blocked=(await row('SELECT $1::int=ANY(pg_blocking_pids($2)) blocked',[childPid,recoveryPid])).blocked;
  assert.equal(blocked,true,'Recovery must actually wait for the competing child transaction');
  await childDb.query('COMMIT');await childRecovery;
  assert.equal((await row('SELECT status FROM alibaba_conversations WHERE id=$1',[childFirst.target.id])).status,'queued','A child committed first prevents classification');
 }finally{await childDb.query('ROLLBACK');if(childRecovery)await childRecovery;childDb.release();}
 await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE device_id=$1 AND task_kind='supplier_thread' AND state IN ('queued','delivered')",[device.id]);
 console.log(JSON.stringify({queuedDuplicateChecks:['legacy queued retirement','current guard restored','same-receipt one-slot replacement','owner and source unchanged','old queued claim and late receipt refused','idempotent cap3','distinct/unbound/retired owner refusal','partial/same-candidate peer invariant','child/binding/reason/GO/input/spec refusal','original candidate and reciprocal source-result refusal','classification rollback','actual classification-child lock waits','child-first refusal'],externalSupplierCalls:0}));
 const queuedStaleSettings=await queuedDuplicate('stale-settings');
 const staleSettings=(await search(await candidate('retirement-stale-settings'),4))[0];await poll(staleSettings,[],c.id);
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'retirement-stale-settings',snapshot FROM settings_versions ORDER BY version DESC LIMIT 1");
 await scheduleOnly(staleSettings,false);await dispatchReads();
 assert.equal((await row('SELECT status FROM alibaba_conversations WHERE id=$1',[staleSettings.id])).status,'attention','Changed settings reject stored receipt replay');
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[staleSettings.candidate_id])).n,3);
 assert.equal((await row('SELECT alibaba_conversation_retired(c) retired FROM alibaba_conversations c WHERE id=$1',[queuedStaleSettings.target.id])).retired,false,'Changed settings cannot classify a legacy queued duplicate');
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[queuedStaleSettings.parent.id])).n,3);
 console.log(JSON.stringify({duplicateRepairChecks:['same-receipt one-slot replacement','immutable retired history','late-result normal refusal without receipt','queued retired claim refusal','no retired actions/messages','globally used and retired companies skipped','direct pre-retired insert refusal','ordinary paused/attention including null reason count','retired-only sourcing and detail history','bound/child/reason/source/GO/settings refusal','actual concurrent global duplicate serialization','actual concurrent active cap serialization','actual concurrent retired-child serialization'],externalSupplierCalls:0}));
 const workspace=(await test.call('/api/candidates/'+source.id+'/contact')).body.website;
 assert.equal(workspace.enabled,true);assert.equal(workspace.status,'attention');assert.equal(workspace.conversations.find(v=>v.id===c.id).messages.length,5);
 const encrypted=await row('SELECT * FROM alibaba_messages WHERE conversation_id=$1 LIMIT 1',[c.id]);assert.ok(!encrypted.body_ciphertext.includes('Synthetic'));assert.ok(decryptSecret(encrypted.body_ciphertext,key,'alibaba-message:'+encrypted.id).length);
 await assert.rejects(test.pool.query("UPDATE alibaba_messages SET body_sha256=repeat('0',64) WHERE id=$1",[encrypted.id]),/immutable/i);
 settings=await row('SELECT * FROM settings_versions ORDER BY version DESC LIMIT 1');
 const queuedMode=await queuedDuplicate('website-disabled');await scheduleOnly(queuedMode.target,false);
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'queued-duplicate-website-off',snapshot || '{\"supplierContactMode\":\"email\"}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1");
 await dispatchReads();
 assert.equal((await row('SELECT alibaba_conversation_retired(c) retired FROM alibaba_conversations c WHERE id=$1',[queuedMode.target.id])).retired,false,'Turning website contact off cannot classify or replace a queued duplicate');
 assert.equal((await row('SELECT count(*)::int n FROM alibaba_conversations WHERE candidate_id=$1',[queuedMode.parent.id])).n,3);
 console.log(JSON.stringify({queuedDuplicateScopeChecks:['changed settings refused','website disabled refused'],externalSupplierCalls:0}));
 console.log(JSON.stringify({ok:true,checks:['exact GO','null spec','three companies','idempotent search receipt','website mail guard','single dispatch','provider message dedupe','honest activity','AI-only follow-up','AI proposal receipt dedupe','pending and unknown suppress AI','changed GO/source/status','inbound and outbound anchors','missing outbound review','manual outbound review','AI failures pause','unsafe AI output','execution provenance','predispatch not_sent receipt','operator-only unstarted recovery','strict recovery reason','fresh recovery receipts','immutable recovery history and round','one recovery task and dispatch','old refusal replay after rearm','started outcomes never rearm','changed inbound rejects recovery','dispatch inbound freshness','dispatch outbound freshness','stale follow-up stops','three follow-up limit','unknown send reconciliation','binding request stop','thread ownership','pre-send scope gate','late receipt retention','expired send recovery','multibyte task limit','workspace encryption'],repairChecks:['15-minute technical AI retry cadence','two retries per inbound','concurrent retry dedupe','duplicate failure receipt','valid proposal after retry','GO/source/action/manual outbound refusal','persisted retry cap','new inbound retry budget','round-limit read-only dispatch without fourth follow-up','started blocked initial read-only dispatch','attention polling exclusions','persisted read scheduling fairness','expired unclaimed read waiting age','two queued reads cap','untouched conversation eventually scheduled'],realAiProposal:Boolean(liveProposal),externalSupplierCalls:0}));
} finally {
 try{if(device)await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE device_id=$1 AND task_kind='supplier_thread' AND state IN ('queued','delivered')",[device.id]);}
 finally{await test.close();}
}
