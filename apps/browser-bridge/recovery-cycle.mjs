import {createHash} from 'node:crypto';
export function createRecoveryCycle({client,adapter,ledger,deviceId,readCredential,shouldStop=()=>false,canClaim=async()=>true}) {
 let running=false;
 async function reconcile(item){
  let server;
  try{server=await client.readTask({deviceId,taskId:item.taskId});}
  catch(error){
   if(error.status===404){ledger.settle({...item,state:'conflict'});return {kind:'conflict',taskId:item.taskId};}
   throw error;
  }
  if(server.taskHash!==item.taskHash)throw new Error('SERVER_TASK_HASH_CONFLICT');
  if(server.state==='cancelled'){
   ledger.settle({...item,state:'cancelled'});return {kind:'cancelled',taskId:item.taskId};
  }
  if(server.state==='completed'){
   if(item.bodyHash&&server.resultHash!==item.bodyHash){ledger.settle({...item,state:'conflict'});return {kind:'conflict',taskId:item.taskId};}
   ledger.complete({...item,receiptId:server.receiptId});return {kind:'completed',taskId:item.taskId};
  }
  if(Date.parse(server.expiresAt)<=Date.now())return {kind:'pending_expiry',taskId:item.taskId};
  if(!item.bodyHash)return {kind:'pending_reconciliation',taskId:item.taskId};
  const observation=ledger.staged(item.taskId,await readCredential());
  if(!observation)throw new Error('STAGED_RESULT_MISSING');
  let receipt;
  try{receipt=await client.submitObservation({deviceId,taskId:item.taskId,taskHash:item.taskHash,observation});}
  catch(error){
   if(error.status===409)return {kind:'pending_reconciliation',taskId:item.taskId};
   if(error.status===400){ledger.settle({...item,state:'conflict'});return {kind:'conflict',taskId:item.taskId};}
   throw error;
  }
  if(receipt.resultHash!==item.bodyHash){ledger.settle({...item,state:'conflict'});return {kind:'conflict',taskId:item.taskId};}
  ledger.complete({...item,receiptId:receipt.receiptId});
  return {kind:'completed',taskId:item.taskId};
 }
 return async()=>{
  if(running)return {kind:'busy'};
  running=true;
  try{
   const reconciled=[];
   for(const item of ledger.pending()){
    if(shouldStop())return {kind:'stopping',reconciled};
    reconciled.push(await reconcile(item));
   }
   if(shouldStop())return {kind:'stopping',reconciled};
   if(!await canClaim())return {kind:'unavailable',reconciled};
   if(shouldStop())return {kind:'stopping',reconciled};
   const delivery=await client.claimTask({deviceId});
   if(shouldStop())return {kind:'stopping',reconciled};
   if(delivery.kind==='idle')return {kind:'idle',reconciled};
   let task;
   try{
    const payload=delivery.envelope.payload;
    if(typeof payload!=='string'||payload.length>11000||createHash('sha256').update(payload).digest('hex')!==delivery.taskHash)throw new Error('hash');
    task=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
   }catch{throw new Error('SERVER_TASK_HASH_CONFLICT');}
   if(task.id!==delivery.taskId||task.deviceId!==deviceId)throw new Error('SERVER_TASK_HASH_CONFLICT');
   const outcome=await adapter.collect(delivery.envelope);
   if(outcome.taskId!==delivery.taskId||(outcome.taskHash&&outcome.taskHash!==delivery.taskHash))throw new Error('SERVER_TASK_HASH_CONFLICT');
   if(outcome.kind!=='captured')return {kind:outcome.kind,taskId:delivery.taskId,reconciled};
   const staged=ledger.stage({taskId:outcome.taskId,taskHash:outcome.taskHash,observation:outcome.observation},await readCredential());
   const result=await reconcile(staged);
   return {...result,reconciled};
  }finally{running=false;}
 };
}
