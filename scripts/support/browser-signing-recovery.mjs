import {createPrivateKey,createPublicKey,createHash} from 'node:crypto';
import {loadBrowserSigningKey} from '../../apps/worker/src/browser-signing-key.ts';

export function browserSigningRecovery(pem){
 if(pem===undefined)return null;
 try{
  if(typeof pem!=='string'||pem.length>16384||!pem.startsWith('-----BEGIN PRIVATE KEY-----'))throw new Error('invalid pem');
  const key=createPrivateKey(pem);
  if(key.asymmetricKeyType!=='ed25519')throw new Error('invalid algorithm');
  return {pem:key.export({format:'pem',type:'pkcs8'}).toString(),fingerprint:createHash('sha256').update(createPublicKey(key).export({format:'der',type:'spki'})).digest('hex')};
 }catch{throw new Error('INVALID_BROWSER_SIGNING_RECOVERY');}
}

export async function verifyBrowserSigningRecovery(db,pem){
 const key=browserSigningRecovery(pem);
 const exists=(await db.query("SELECT to_regclass('public.browser_signing_identity') IS NOT NULL AS present")).rows[0].present;
 const identity=exists?(await db.query('SELECT fingerprint FROM browser_signing_identity WHERE singleton=1')).rows[0]:undefined;
 if(identity&&identity.fingerprint!==key?.fingerprint)throw new Error('BROWSER_SIGNING_RECOVERY_REQUIRED');
 return key?.fingerprint??null;
}

export async function configuredBackupRecovery(source){
 if(source.APP_ENV!=='development')throw new Error('LOCAL_RECOVERY_CONFIGURATION_REQUIRED');
 const key=source.BROWSER_SIGNING_KEY_FILE?await loadBrowserSigningKey({...source,BROWSER_TASKS_ENABLED:'true'},'development'):null;
 return {authSecret:source.BETTER_AUTH_SECRET,encryptionKeyHex:source.ENCRYPTION_KEY,
  ...(key?{browserSigningKeyPem:key.export({format:'pem',type:'pkcs8'}).toString()}:{}),
 };
}
