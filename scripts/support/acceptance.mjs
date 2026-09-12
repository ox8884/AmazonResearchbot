import { randomBytes, createHmac } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createPool,migrate,seedInitialSettings } from '../../packages/db/src/index.ts';
import { INITIAL_SETTINGS } from '../../packages/domain/src/settings.ts';
import { PgBoss } from 'pg-boss';
import { buildApp } from '../../apps/api/src/app.ts';
import assert from 'node:assert/strict';
export function otp(secret){const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret.toUpperCase().replace(/=+$/,'')){const n=abc.indexOf(c);assert.ok(n>=0);bits+=n.toString(2).padStart(5,'0');}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const offset=digest[digest.length-1]&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
export async function openAcceptance(options={}){
  const webOrigin=options.webOrigin??"http://localhost:5173";
  const web=new URL(webOrigin);assert.ok(["localhost","127.0.0.1"].includes(web.hostname)&&web.protocol==="http:");
  const root=new URL('../../',import.meta.url);const text=await readFile(new URL('.env',root),'utf8');const vars=Object.fromEntries(text.split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
  assert.notEqual(vars.APP_ENV,'production');const target=new URL(vars.DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(target.hostname));
  const admin=createPool(target.toString());let saved;
  const databaseKey=options.databaseKey??'acceptance-db';assert.match(databaseKey,/^[a-z0-9-]+$/);
  const pointer=new URL(`data/${databaseKey}.json`,root);await mkdir(new URL('data/',root),{recursive:true});
  try {const identity=await admin.query("SELECT environment FROM deployment_identity WHERE environment='development'");assert.equal(identity.rowCount,1);
    try{saved=JSON.parse(await readFile(pointer,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;const name='forge_ops_acceptance_'+randomBytes(6).toString('hex');await admin.query(`CREATE DATABASE "${name}"`);saved={name,state:'created'};await writeFile(pointer,JSON.stringify(saved));}
  }finally{await admin.end();}
  assert.match(saved.name,/^forge_ops_acceptance_[a-f0-9]{12}$/);target.pathname='/'+saved.name;const pool=createPool(target.toString());
  let app;let lease;
  try {
    lease=await pool.connect();await lease.query("SELECT pg_advisory_lock(hashtext('forge.acceptance'))");
    if(saved.state==='ready'){const marker=await pool.query("SELECT worker_identity FROM deployment_identity WHERE environment='development'");assert.equal(marker.rows[0]?.worker_identity,'acceptance-tests:'+saved.name);}
    await migrate(pool);await seedInitialSettings(pool);
    await pool.query("UPDATE deployment_identity SET worker_identity=$1 WHERE environment='development'",['acceptance-tests:'+saved.name]);
    await writeFile(pointer,JSON.stringify({...saved,state:'ready'}));
    const seed=await pool.query('SELECT max(version)::int AS version FROM settings_versions');
    await pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'acceptance-fixture',$2::jsonb)",[seed.rows[0].version+1,JSON.stringify(INITIAL_SETTINGS)]);
    const boss=new PgBoss({connectionString:target.toString(),migrate:true,supervise:false,schedule:false});await boss.start();await boss.createQueue('candidate.advance');await boss.stop({graceful:false,timeout:2000});
    const env={appEnv:'development',databaseUrl:target.toString(),webOrigin,apiPort:3001,authSecret:options.authSecret??randomBytes(32).toString('hex'),encryptionKeyHex:options.encryptionKeyHex??randomBytes(32).toString('hex'),jsDailyWireCap:0,mailTransport:options.mailTransport??'disabled'};
    const built=await buildApp(env,pool,options.aiTransport?{aiTransport:options.aiTransport}:{});app=built.app;app.log.level='silent';await app.ready();const jar=new Map();
    const call=async(path,body,extra={})=>{const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'localhost:5173',origin:env.webOrigin,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra},...(body===undefined?{}:{payload:body})});for(const c of response.cookies)jar.set(c.name,c.value);return {status:response.statusCode,body:response.json()};};
    const runId=randomBytes(6).toString('hex'),email=`qa-${runId}@fixture.invalid`,password=randomBytes(24).toString('base64url');
    assert.equal((await call('/api/auth/sign-up/email',{email,password,name:'Acceptance fixture'})).status,200);
    assert.equal((await call('/api/session')).body.user.twoFactorEnabled,false);
    assert.equal((await call('/api/candidates')).status,403);
    let secret;
    if(!options.unenrolled){
    const enabled=await call('/api/auth/two-factor/enable',{password,method:'totp'});assert.equal(enabled.status,200);secret=new URL(enabled.body.totpURI).searchParams.get('secret');assert.ok(secret);
    assert.equal((await call('/api/candidates')).status,403,'Initial two-factor enrollment must be verified before business access');
    assert.equal((await call('/api/auth/two-factor/verify-totp',{code:otp(secret)})).status,200);
    assert.equal((await call('/api/session')).body.user.twoFactorEnabled,true);
    }
    return {app,pool,boss:built.boss,call,runId,encryptionKeyHex:env.encryptionKeyHex,database:saved.name,databaseUrl:target.toString(),authFixture:{email,password,totpSecret:secret},close:async()=>{try{await app.close();}finally{lease.release();await pool.end();}}};
  }catch(error){if(app)await app.close();lease?.release();await pool.end();throw error;}
}
