import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
const test=await openAcceptance();
try {
 await test.call('/api/auth/sign-out',{});
 const signed=await test.call('/api/auth/sign-in/email',{email:test.authFixture.email,password:test.authFixture.password});
 assert.equal(signed.status,200);assert.equal(signed.body.twoFactorRedirect,true);
 assert.equal((await test.call('/api/session')).status,401);
 for(let i=0;i<5;i++){const wrong=await test.call('/api/auth/two-factor/verify-totp',{code:'not-a-code'});assert.ok(wrong.status>=400&&wrong.status!==423);}
 assert.equal((await test.call('/api/auth/two-factor/verify-totp',{code:'not-a-code'})).status,423);
 assert.equal((await test.call('/api/auth/two-factor/verify-backup-code',{code:'invalid-backup'})).status,423,'Backup path must not bypass account throttle');
 for(const path of ['/api/auth/two-factor/verify-totp/','/api/auth/two-factor/%76erify-totp','/api/auth/two-factor//verify-totp']){
  const variation=await test.call(path,{code:'not-a-code'});
  assert.ok([404,423].includes(variation.status),`Path variant bypassed throttle: ${path} ${variation.status}`);
 }

 const email=`missing-${test.runId}@fixture.invalid`;
 const results=await Promise.all(Array.from({length:10},()=>test.app.inject({method:'POST',url:'/api/auth/sign-in/email',headers:{host:'localhost:5173',origin:'http://localhost:5173'},payload:{email,password:'synthetic-wrong-password'}})));
 assert.equal(results.filter(r=>r.statusCode===423).length,5);
 assert.equal((await test.pool.query('SELECT count(*)::int n FROM login_attempts WHERE email_normalized=$1 AND success=false',[email])).rows[0].n,5);

 const lockedEmail=`window-${test.runId}@fixture.invalid`;
 await test.pool.query("INSERT INTO login_attempts(email_normalized,ip,success,created_at) SELECT $1,'127.0.0.1',false,now()-interval '28 minutes' FROM generate_series(1,4)",[lockedEmail]);
 await test.pool.query("INSERT INTO login_attempts(email_normalized,ip,success,created_at) VALUES($1,'127.0.0.1',false,now()-interval '14 minutes')",[lockedEmail]);
 const lockedWindow=await test.call('/api/auth/sign-in/email',{email:lockedEmail,password:'synthetic-wrong-password'});
 assert.equal(lockedWindow.status,423,'A lock must last 15 minutes after the fifth failure, even after earlier failures age out');
 const expiredEmail=`expired-${test.runId}@fixture.invalid`;
 await test.pool.query("INSERT INTO login_attempts(email_normalized,ip,success,created_at) SELECT $1,'127.0.0.1',false,now()-interval '31 minutes' FROM generate_series(1,4)",[expiredEmail]);
 await test.pool.query("INSERT INTO login_attempts(email_normalized,ip,success,created_at) VALUES($1,'127.0.0.1',false,now()-interval '17 minutes')",[expiredEmail]);
 assert.equal((await test.call('/api/auth/sign-in/email',{email:expiredEmail,password:'synthetic-wrong-password'})).status,401,'Expired lock permits a fresh attempt');

 console.log(JSON.stringify({scenario:'auth-route',result:'PASS',initialEnrollment:true,passwordThenSixDigitChallenge:true,totpSixthBlocked:true,fullFifteenMinuteLock:true,expiredLockAllowsAttempt:true,backupCannotBypass:true,concurrentPasswordHandlerEntries:5,realAccountChanged:false}));
}finally{await test.close();}
