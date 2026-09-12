import {createPublicKey,verify} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {browserTaskSchema,BROWSER_TASK_SIGNATURE_PREFIX,MAX_BROWSER_TASK_BYTES} from '../../packages/domain/src/browser-task.ts';

export function createBrowserTaskVerifier(configuration) {
 let url,key;
 try {
  url=new URL(configuration.origin);
  if(typeof configuration.publicKey!=='string'||!configuration.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'))throw new Error('KEY');
  key=createPublicKey(configuration.publicKey);
 }catch{throw new Error('INVALID_BROWSER_VERIFIER_CONFIG');}
 const local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if((!local&&url.protocol!=='https:')||url.origin!==configuration.origin||url.username||url.password||key.asymmetricKeyType!=='ed25519'||
    typeof configuration.deviceId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(configuration.deviceId))throw new Error('INVALID_BROWSER_VERIFIER_CONFIG');
 const origin=url.origin,deviceId=configuration.deviceId,now=configuration.now??Date.now;
 if(typeof now!=='function')throw new Error('INVALID_BROWSER_VERIFIER_CONFIG');
 return envelope=>{
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).length!==3||Object.keys(envelope).some(key=>!['version','payload','signature'].includes(key))||
     envelope.version!==1||typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||
     !/^[A-Za-z0-9_-]+$/.test(envelope.payload)||envelope.payload.length>Math.ceil(MAX_BROWSER_TASK_BYTES*4/3)||
     !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))throw new Error('BROWSER_TASK_REJECTED');
  const signature=Buffer.from(envelope.signature,'base64url');
  if(signature.toString('base64url')!==envelope.signature||
     !verify(null,Buffer.from(BROWSER_TASK_SIGNATURE_PREFIX+envelope.payload),key,signature))throw new Error('BROWSER_TASK_REJECTED');
  const bytes=Buffer.from(envelope.payload,'base64url');
  if(bytes.length>MAX_BROWSER_TASK_BYTES||bytes.toString('base64url')!==envelope.payload)throw new Error('BROWSER_TASK_REJECTED');
  let raw;
  try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('BROWSER_TASK_REJECTED');}
  const parsed=browserTaskSchema.safeParse(raw),time=now();
  if(!parsed.success||!Number.isFinite(time)||parsed.data.issuerOrigin!==origin||parsed.data.deviceId!==deviceId||
     Date.parse(parsed.data.issuedAt)>time||Date.parse(parsed.data.expiresAt)<=time)throw new Error('BROWSER_TASK_REJECTED');
  return parsed.data;
 };
}
