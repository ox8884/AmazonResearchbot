import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {approvedRfq} from './support/approved-rfq.mjs';
import {createMailpitTransport} from '../packages/integrations/src/mail/mailpit.ts';
import {createContactCycle} from '../apps/worker/src/contact-loop.ts';
const test=await openAcceptance();
try{
  const fixture=await approvedRfq(test,'persistence');let accepted=false,failOnce=true,sends=0;
  const base=createMailpitTransport('development');
  const transport={...base,send:async(...args)=>{sends++;const result=await base.send(...args);if(result.kind==='sent')accepted=true;return result;}};
  const faultPool=new Proxy(test.pool,{get(target,key){if(key==='connect')return async()=>{if(accepted&&failOnce){failOnce=false;throw new Error('SIMULATED_DB_UNAVAILABLE_AFTER_ACCEPTANCE');}return target.connect();};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const cycle=createContactCycle(faultPool,transport);
  await assert.rejects(cycle(),/SIMULATED_DB_UNAVAILABLE/);assert.equal(sends,1);
  assert.equal((await test.pool.query('SELECT state FROM external_actions WHERE id=$1',[fixture.action])).rows[0].state,'dispatching');
  await cycle();assert.equal(sends,1);assert.equal((await test.pool.query('SELECT state FROM external_actions WHERE id=$1',[fixture.action])).rows[0].state,'sent');
  assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[fixture.candidateId])).rows[0].stage,'awaiting_quote');
  await cycle();assert.equal(sends,1);
  const response=await fetch('http://127.0.0.1:8025/api/v1/search?query='+test.runId+'&limit=50');const messages=await response.json();assert.equal(messages.messages.filter(m=>m.MessageID===`forge-rfq-${fixture.action}@forge.invalid`).length,1);
  console.log(JSON.stringify({scenario:'contact-persistence',result:'PASS',worker:'remains alive',fault:'DB unavailable after SMTP acceptance',recovered:'next cycle receipt-only reconciliation',smtpSends:sends,matchingMessages:1,externalDeliveries:0}));
}finally{await test.close();}
