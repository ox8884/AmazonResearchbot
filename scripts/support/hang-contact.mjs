import assert from 'node:assert/strict';
import { createPool } from '../../packages/db/src/index.ts';
import { createMailpitTransport } from '../../packages/integrations/src/mail/mailpit.ts';
import { dispatchContact } from '../../apps/worker/src/contact-runner.ts';
const url=new URL(process.env.ACCEPTANCE_DB_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/forge_ops_acceptance_[a-f0-9]{12}$/);
const pool=createPool(url.toString());const identity=await pool.query("SELECT worker_identity FROM deployment_identity WHERE environment='development'");assert.equal(identity.rows[0]?.worker_identity,'acceptance-tests:'+url.pathname.slice(1));
const id=process.env.CONTACT_ACTION_ID;assert.match(id,/^[a-f0-9-]{36}$/);
const local=createMailpitTransport('development');const timer=setInterval(()=>{},1000);
try {await dispatchContact(pool,id,{...local,send:async(payload,actionId)=>{const receipt=await local.send(payload,actionId);assert.equal(receipt.kind,'sent');process.stdout.write('LOCAL_ACCEPTED\n');await new Promise(()=>{});return receipt;}});}finally{clearInterval(timer);await pool.end();}
