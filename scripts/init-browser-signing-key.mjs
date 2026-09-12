import {generateKeyPairSync,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
try{
 const {values}=parseArgs({options:{output:{type:'string'}}});
 if(!values.output)throw new Error('Output required');
 const target=path.resolve(values.output);
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 await mkdir(path.dirname(target),{recursive:true,mode:0o700});
 await writeFile(target,privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({created:true,publicKey:publicKey.export({format:'pem',type:'spki'}).toString(),fingerprint:createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex')}));
}catch{console.error('Signing key not created. Provide a new writable private path; existing files are never replaced.');process.exitCode=1;}
