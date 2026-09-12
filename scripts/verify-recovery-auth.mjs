import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {openAcceptance} from './support/acceptance.mjs';
import {createRecoveryCodeStorage} from '../apps/api/src/recovery-code-storage.ts';
const authSecret=randomBytes(32).toString('hex');
const storage=createRecoveryCodeStorage(authSecret);
const test=await openAcceptance({databaseKey:'recovery-auth-'+Date.now(),authSecret});
try{
 const generated=await test.call('/api/auth/two-factor/generate-backup-codes',{password:test.authFixture.password});
 assert.equal(generated.status,200);const codes=generated.body.backupCodes;assert.ok(Array.isArray(codes)&&codes.length===10);
 const userId=(await test.call('/api/session')).body.user.id;
 const stored=async()=>(await test.pool.query('SELECT backup_codes FROM two_factor WHERE user_id=$1',[userId])).rows[0].backup_codes;
 assert.ok((await stored()).startsWith('frc1.'),'Recovery-code storage must be hash-only');
 const hashes=await storage.decrypt(await stored());
 assert.ok(codes.every(code=>!hashes.includes(code)));
 const signIn=()=>test.call('/api/auth/sign-in/email',{email:test.authFixture.email,password:test.authFixture.password});
 await test.call('/api/auth/sign-out',{});assert.equal((await signIn()).body.twoFactorRedirect,true);
 assert.equal((await test.call('/api/auth/two-factor/verify-backup-code',{code:codes[0]})).status,200);
 assert.equal((await test.call('/api/session')).status,200);
 assert.equal(JSON.parse(await storage.decrypt(await stored())).length,9);
 await test.call('/api/auth/sign-out',{});await signIn();
 assert.equal((await test.call('/api/auth/two-factor/verify-backup-code',{code:codes[0]})).status,401,'A recovery code is one-use');
 const hashToken=JSON.parse(await storage.decrypt(await stored()))[0];const beforeAttack=await stored();
 assert.equal((await test.call('/api/auth/two-factor/verify-backup-code',{code:hashToken})).status,401,'A stored hash is not a usable recovery code');
 assert.equal(await stored(),beforeAttack);
 assert.equal((await test.call('/api/auth/two-factor/verify-backup-code',{code:codes[1]})).status,200,'Unused codes still work after another was consumed');
 const concurrent=await Promise.all([test.call('/api/auth/two-factor/verify-backup-code',{code:codes[2]}),test.call('/api/auth/two-factor/verify-backup-code',{code:codes[2]})]);
 assert.equal(concurrent.filter(result=>result.status===200).length,1,'Concurrent use of one code succeeds once');
 assert.equal(JSON.parse(await storage.decrypt(await stored())).length,7);
 const requireFromApi=createRequire(new URL('../apps/api/package.json',import.meta.url));
 const {symmetricEncrypt}=await import(pathToFileURL(requireFromApi.resolve('better-auth/crypto')).href);
 const legacyCodes=['legacy-'+randomBytes(8).toString('hex'),'unused-'+randomBytes(8).toString('hex')];
 const legacy=await symmetricEncrypt({key:authSecret,data:JSON.stringify(legacyCodes)});
 await test.pool.query('UPDATE two_factor SET backup_codes=$1 WHERE user_id=$2',[legacy,userId]);
 await test.call('/api/auth/sign-out',{});await signIn();
 assert.equal((await test.call('/api/auth/two-factor/verify-backup-code',{code:legacyCodes[0]})).status,200,'Existing printed codes remain usable during migration');
 assert.ok((await stored()).startsWith('frc1.'));
 assert.deepEqual(JSON.parse(await storage.decrypt(await stored())),[storage.hashInput(legacyCodes[1])]);
 assert.equal((await test.call('/api/auth/two-factor/view-backup-codes',{})).status,404);
 assert.deepEqual((await test.call('/api/security/recovery-codes')).body,{remaining:1});
 const currentHash=JSON.parse(await storage.decrypt(await stored()))[0];const beforeFormats=await stored();
 for(const [type,payload] of [['application/x-www-form-urlencoded','code='+encodeURIComponent(currentHash)],['text/plain',JSON.stringify({code:currentHash})]]){
  const rejected=await test.call('/api/auth/two-factor/verify-backup-code',payload,{'content-type':type});
  assert.ok(rejected.status>=400,'Alternate body formats cannot turn a stored hash into a bearer code');
 }
 assert.equal(await stored(),beforeFormats);
 const beforeFailures=await stored();const statuses=[];
 for(let index=0;index<6;index++)statuses.push((await test.call('/api/auth/two-factor/generate-backup-codes',{password:'wrong-synthetic-password'})).status);
 assert.equal(statuses.at(-1),423);assert.ok(statuses.filter(status=>status===400).length<=5);
 assert.equal(await stored(),beforeFailures,'Failed password checks cannot replace recovery codes');

 console.log(JSON.stringify({scenario:'recovery-auth',result:'PASS',database:test.database,hashOnly:true,sensitivePasswordThrottled:true,remainingCountOnly:true,oneUse:true,concurrentOneUse:true,hashNotBearer:true,alternateBodiesRejected:true,remainingCodesWork:true,legacyCodesPreserved:true,plaintextReadEndpoint:false,realUsersChanged:false}));
}finally{await test.close();}
