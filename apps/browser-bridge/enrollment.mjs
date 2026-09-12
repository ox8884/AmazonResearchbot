import {verifiedSigningIdentity} from './signing-identity.mjs';
import {bridgeDeviceSchema,bridgeCapabilitySchema} from '../../packages/domain/src/browser-device.ts';
import {deviceVault} from './device-vault.mjs';

function approvedOrigin(value) {
 if(typeof value!=='string')throw new Error('INVALID_BRIDGE_ORIGIN');
 let url;
 try{url=new URL(value);}catch{throw new Error('INVALID_BRIDGE_ORIGIN');}
 const loopback=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!loopback)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('INVALID_BRIDGE_ORIGIN');
 return url.origin;
}
async function requestBridge(origin, request) {
 const response=await fetch(origin+request.path,{
  method:request.body?'POST':'GET',redirect:'manual',cache:'no-store',
  signal:AbortSignal.timeout(15000),
  headers:{origin,...(request.body?{'content-type':'application/json'}:{}),...(request.credential?{authorization:'Bearer '+request.credential}:{})},
  ...(request.body?{body:JSON.stringify(request.body)}:{}),
 });
 if(!request.status.includes(response.status)){await response.body?.cancel();throw Object.assign(new Error('BRIDGE_REQUEST_REJECTED'),{status:response.status});}
 const reader=response.body?.getReader();
 if(!reader)throw new Error('BRIDGE_RESPONSE_INVALID');
 const chunks=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>(request.maxBytes??4096))throw new Error('BRIDGE_RESPONSE_INVALID');chunks.push(Buffer.from(value));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }finally{try{await reader.cancel();}finally{reader.releaseLock();}}
}
export function createBridgeClient(configuration) {
 const origin=approvedOrigin(configuration.origin);
 async function enrollBrowserDevice(input) {
 if(!input||Object.keys(input).some(key=>!['pairingCode','name'].includes(key)))throw new Error('INVALID_ENROLLMENT');
 if(typeof input.pairingCode!=='string'||!/^fbp_[a-f0-9]{64}$/.test(input.pairingCode)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80)throw new Error('INVALID_ENROLLMENT');
 let device;
 try{device=await requestBridge(origin,{path:'/api/bridge/pair',status:[201],body:{pairingCode:input.pairingCode,name:input.name.trim()}});}
 catch{throw new Error('BRIDGE_ENROLLMENT_REJECTED');}
 if(!device||typeof device.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(device.id)||typeof device.credential!=='string'||!/^fbd_[a-f0-9]{64}$/.test(device.credential))throw new Error('BRIDGE_RESPONSE_INVALID');
 let signingKey;
 try{signingKey=verifiedSigningIdentity(device.signingKey);}
 catch{throw Object.assign(new Error('DEVICE_SIGNING_IDENTITY_REJECTED_REVOKE_REGISTRATION'),{deviceId:device.id});}
 try{await deviceVault('create',{origin,deviceId:device.id,credential:device.credential});}
 catch{
  const error=new Error('DEVICE_STORAGE_FAILED_REVOKE_REGISTRATION');
  error.deviceId=device.id;
  throw error;
 }
 return {deviceId:device.id,credentialStored:true,browserAvailable:false,signingKey};
}
 async function checkDeviceRegistration(input) {
 if(!input||Object.keys(input).some(key=>key!=='deviceId'))throw new Error('INVALID_DEVICE_REQUEST');
 const credential=await deviceVault('read',{origin,deviceId:input.deviceId});
 if(!credential)throw new Error('DEVICE_CREDENTIAL_MISSING');
 let device;
 try{device=await requestBridge(origin,{path:'/api/bridge/device',status:[200],credential});}
 catch{throw new Error('DEVICE_REGISTRATION_REJECTED');}
 const parsed=bridgeDeviceSchema.safeParse(device);
 if(!parsed.success||parsed.data.id!==input.deviceId)throw new Error('BRIDGE_RESPONSE_INVALID');
 return {deviceId:device.id,registered:true,browserAvailable:parsed.data.browserAvailable,connectionState:parsed.data.connectionState,checkedAt:parsed.data.checkedAt,capabilities:parsed.data.capabilities};
}

 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 function taskInput(input,keys){
  if(!input||Object.keys(input).some(key=>!keys.includes(key)))throw new Error('INVALID_DEVICE_REQUEST');
  if(keys.includes('taskId')&&(typeof input.taskId!=='string'||!uuid.test(input.taskId)))throw new Error('INVALID_TASK_ID');
 }
 async function deviceRequest(deviceId,request){
  const credential=await deviceVault('read',{origin,deviceId});
  if(!credential)throw new Error('DEVICE_CREDENTIAL_MISSING');
  return requestBridge(origin,{...request,credential});
 }
 async function reportCapabilities(input){
  taskInput(input,['deviceId','connected','supportedTasks','keyFingerprint']);
  if(typeof input.connected!=='boolean'||!Array.isArray(input.supportedTasks)||input.supportedTasks.length>bridgeCapabilitySchema.options.length||input.supportedTasks.some(kind=>!bridgeCapabilitySchema.safeParse(kind).success)||typeof input.keyFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.keyFingerprint))throw new Error('INVALID_CAPABILITIES');
  const result=await deviceRequest(input.deviceId,{path:'/api/bridge/capabilities',status:[200],body:{connected:input.connected,supportedTasks:input.supportedTasks,keyFingerprint:input.keyFingerprint}});
  if(result?.reported!==true)throw new Error('BRIDGE_RESPONSE_INVALID');
  return {reported:true};
 }
 async function claimTask(input){
  taskInput(input,['deviceId']);
  const result=await deviceRequest(input.deviceId,{path:'/api/bridge/tasks/claim',status:[200],body:{},maxBytes:16384});
  if(result?.kind==='idle')return {kind:'idle'};
  const envelope=result?.envelope;
  if(result?.kind!=='task'||!uuid.test(result.taskId)||!/^[a-f0-9]{64}$/.test(result.taskHash)||!envelope||envelope.version!==1||typeof envelope.payload!=='string'||typeof envelope.signature!=='string')throw new Error('BRIDGE_RESPONSE_INVALID');
  return {kind:'task',taskId:result.taskId,taskHash:result.taskHash,envelope};
 }
 async function readTask(input){
  taskInput(input,['deviceId','taskId']);
  const result=await deviceRequest(input.deviceId,{path:'/api/bridge/tasks/'+input.taskId,status:[200]});
  if(!result||result.taskId!==input.taskId||!/^[a-f0-9]{64}$/.test(result.taskHash)||!['queued','delivered','completed','cancelled'].includes(result.state)||typeof result.expiresAt!=='string'||!Number.isFinite(Date.parse(result.expiresAt))||(result.state==='completed'?(!uuid.test(result.receiptId)||typeof result.resultHash!=='string'||!/^[a-f0-9]{64}$/.test(result.resultHash)):(result.receiptId!==null||result.resultHash!==null)))throw new Error('BRIDGE_RESPONSE_INVALID');
  return {taskId:result.taskId,taskHash:result.taskHash,state:result.state,receiptId:result.receiptId,resultHash:result.resultHash,expiresAt:result.expiresAt};
 }
 async function submitObservation(input){
  taskInput(input,['deviceId','taskId','taskHash','observation']);
  if(typeof input.taskHash!=='string'||!/^[a-f0-9]{64}$/.test(input.taskHash))throw new Error('INVALID_TASK_HASH');
  const result=await deviceRequest(input.deviceId,{path:'/api/bridge/tasks/'+input.taskId+'/results',status:[200,201],body:{taskHash:input.taskHash,observation:input.observation},maxBytes:16384});
  if(!result||!['accepted','duplicate'].includes(result.kind)||!uuid.test(result.receiptId)||typeof result.resultHash!=='string'||!/^[a-f0-9]{64}$/.test(result.resultHash)||!Array.isArray(result.captureIds)||result.captureIds.length>200||!result.captureIds.every(id=>typeof id==='string'&&uuid.test(id)))throw new Error('BRIDGE_RESPONSE_INVALID');
  return {kind:result.kind,receiptId:result.receiptId,resultHash:result.resultHash,captureIds:result.captureIds};
 }
 return Object.freeze({enrollBrowserDevice,checkDeviceRegistration,claimTask,readTask,submitObservation,reportCapabilities});
}
