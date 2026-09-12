import {hkdfSync,createHash} from 'node:crypto';
import {browserObservationSchema} from '../../packages/domain/src/browser-observation.ts';
import {encryptSecret,decryptSecret} from '../../packages/security/src/secrets.ts';
import {exactPayloadHash} from '../../packages/security/src/approval-hash.ts';
function key(credential,scope){
 if(typeof credential!=='string'||!/^fbd_[a-f0-9]{64}$/.test(credential))throw new Error('INVALID_STAGING_CREDENTIAL');
 return Buffer.from(hkdfSync('sha256',Buffer.from(credential.slice(4),'hex'),createHash('sha256').update(scope).digest(),Buffer.from('forge-browser-staging:v1'),32));
}
export function sealObservation(observation,credential,scope){
 const parsed=browserObservationSchema.safeParse(observation);
 if(!parsed.success)throw new Error('INVALID_STAGED_OBSERVATION');
 const bytes=Buffer.from(JSON.stringify(parsed.data));
 if(bytes.length>4*1024*1024)throw new Error('STAGED_OBSERVATION_TOO_LARGE');
 const secret=key(credential,scope);
 try{return {bodyHash:exactPayloadHash(parsed.data),ciphertext:encryptSecret(bytes,secret,scope)};}
 finally{secret.fill(0);}
}
export function openObservation(record,credential,scope){
 const secret=key(credential,scope);
 try{
  const observation=browserObservationSchema.parse(JSON.parse(decryptSecret(record.ciphertext,secret,scope).toString('utf8')));
  if(exactPayloadHash(observation)!==record.body_hash)throw new Error('STAGED_OBSERVATION_CONFLICT');
  return observation;
 }finally{secret.fill(0);}
}
