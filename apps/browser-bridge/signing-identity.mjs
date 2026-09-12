import {createPublicKey,createHash} from 'node:crypto';

export function verifiedSigningIdentity(value){
 if(value===null)return null;
 try{
  if(!value||typeof value.publicKey!=='string'||value.publicKey.length>16384||!value.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')||typeof value.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(value.fingerprint))throw new Error('invalid identity');
  const key=createPublicKey(value.publicKey);
  const fingerprint=createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
  if(key.asymmetricKeyType!=='ed25519'||fingerprint!==value.fingerprint)throw new Error('identity mismatch');
  return {publicKey:key.export({format:'pem',type:'spki'}).toString(),fingerprint};
 }catch{throw new Error('BRIDGE_SIGNING_IDENTITY_INVALID');}
}
