import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';

// Public deterministic test key, never used for a real browser registration.
export function browserSigningFixture(){
 const seed=createHash('sha256').update('Forge synthetic acceptance browser signing fixture v1').digest();
 const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
 return {privateKey,publicKey:createPublicKey(privateKey)};
}
