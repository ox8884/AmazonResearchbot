import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openAcceptance,otp} from './support/acceptance.mjs';
const test=await openAcceptance({databaseKey:'session-management-'+Date.now()});
try{
 const userId=(await test.call('/api/session')).body.user.id;
 const otherUser=randomUUID(),otherSession=randomUUID(),expired=randomUUID(),foreignSession=randomUUID();
 const sentinel='SESSION_TOKEN_MUST_NOT_BE_EXPOSED_'+test.runId;
 await test.pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[otherUser,'Other synthetic account',`other-${test.runId}@fixture.invalid`]);
 for(const [id,owner,seconds] of [[otherSession,userId,3600],[expired,userId,-1],[foreignSession,otherUser,3600]]){
  await test.pool.query("INSERT INTO session(id,token,user_id,expires_at,user_agent,ip_address) VALUES($1,$2,$3,now()+($4*interval '1 second'),$5,'127.0.0.1')",[id,sentinel+id,owner,seconds,'Synthetic browser']);
 }
 const list=await test.call('/api/security/sessions');assert.equal(list.status,200);
 assert.equal(list.body.sessions.filter(s=>s.current).length,1);
 assert.ok(list.body.sessions.every(s=>s.address===null||s.address.trim().length>0),'Missing connection addresses must be explicit unknowns');
 assert.ok(list.body.sessions.some(s=>s.id===otherSession));assert.ok(!list.body.sessions.some(s=>s.id===expired||s.id===foreignSession));
 assert.equal(JSON.stringify(list.body).includes(sentinel),false);assert.ok(list.body.sessions.every(s=>!('token' in s)&&!('userAgent' in s)));
 const current=list.body.sessions.find(s=>s.current);
 assert.equal((await test.call(`/api/security/sessions/${current.id}/revoke`,{})).status,400,'Current session uses explicit sign-out instead');
 assert.equal((await test.call(`/api/security/sessions/${foreignSession}/revoke`,{})).status,404);
 assert.equal((await test.pool.query('SELECT id FROM session WHERE id=$1',[foreignSession])).rowCount,1);
 assert.equal((await test.call(`/api/security/sessions/${otherSession}/revoke`,{},{origin:'https://wrong.invalid'})).status,403);
 assert.equal((await test.call(`/api/security/sessions/${otherSession}/revoke`,{})).status,200);
 assert.equal((await test.pool.query('SELECT id FROM session WHERE id=$1',[otherSession])).rowCount,0);
 assert.equal((await test.call('/api/session')).status,200,'Revoking another session preserves this one');
 assert.equal((await test.pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='session_revoked' AND target=$1",[otherSession])).rows[0].count,1);
 const auditSentinel='AUDIT_PRIVATE_META_'+test.runId;
 const ownAudit=randomUUID(),foreignAudit=randomUUID();
 await test.pool.query("INSERT INTO audit_events(id,actor,action,target,meta) VALUES($1,$2,'approve',$3,$4::jsonb),($5,$6,'session_revoked',$3,$4::jsonb)",[ownAudit,userId,sentinel,JSON.stringify({password:auditSentinel}),foreignAudit,otherUser]);
 const audit=await test.call('/api/security/audit');assert.equal(audit.status,200);
 assert.ok(audit.body.events.some(e=>e.id===ownAudit));assert.ok(!audit.body.events.some(e=>e.id===foreignAudit));
 assert.ok(audit.body.events.some(e=>e.action==='session_revoked'));
 assert.equal(JSON.stringify(audit.body).includes(auditSentinel),false);assert.equal(JSON.stringify(audit.body).includes(sentinel),false);
 assert.ok(audit.body.events.every(e=>!('meta' in e)&&!('target' in e)&&!('approvalHash' in e)));
 const otherJar=new Map();
 const otherCall=async(path,body)=>{
  const response=await test.app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'localhost:5173',origin:'http://localhost:5173',cookie:[...otherJar].map(([name,value])=>`${name}=${value}`).join('; ')},...(body===undefined?{}:{payload:body})});
  for(const cookie of response.cookies)otherJar.set(cookie.name,cookie.value);
  return {status:response.statusCode,body:response.json()};
 };
 assert.equal((await otherCall('/api/auth/sign-in/email',{email:test.authFixture.email,password:test.authFixture.password})).body.twoFactorRedirect,true);
 assert.equal((await otherCall('/api/auth/two-factor/verify-totp',{code:otp(test.authFixture.totpSecret)})).status,200);
 const second=(await otherCall('/api/security/sessions')).body.sessions.find(session=>session.current);
 assert.ok(second&&second.id!==current.id);
 assert.equal((await test.call(`/api/security/sessions/${second.id}/revoke`,{})).status,200);
 assert.equal((await otherCall('/api/security/sessions')).status,401,'A revoked real session cannot authenticate');
 assert.equal((await test.call('/api/session')).status,200);
 await test.call('/api/auth/sign-out',{});
 assert.equal((await test.call('/api/security/sessions')).status,401);
 assert.equal((await test.call('/api/security/audit')).status,401);
 console.log(JSON.stringify({scenario:'session-management',result:'PASS',database:test.database,tokenExposure:false,ownershipEnforced:true,currentSessionPreserved:true,revokedSessionRejected:true,expiredSessionsHidden:true,auditRecorded:true,realSessionsTouched:false}));
}finally{await test.close();}
