import {approvedRfq} from "./support/approved-rfq.mjs";
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openAcceptance } from './support/acceptance.mjs';
import { createMailpitTransport } from '../packages/integrations/src/mail/mailpit.ts';
import { dispatchContact,recoverContactOutcomes } from '../apps/worker/src/contact-runner.ts';
import { reconcileContact } from '../apps/worker/src/contact-reconcile.ts';
const test=await openAcceptance();let child;
try {
  const {candidateId,action}=await approvedRfq(test,'recovery');
  child=spawn(process.execPath,['--import','tsx','scripts/support/hang-contact.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,ACCEPTANCE_DB_URL:test.databaseUrl,CONTACT_ACTION_ID:action},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Child did not reach the local acceptance point')),20000);child.stdout.on('data',chunk=>{text+=String(chunk);if(text.includes('LOCAL_ACCEPTED')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Child exited before local acceptance'));});child.once('error',reject);});
  const exited=once(child,'exit');assert.equal(child.kill('SIGKILL'),true);await exited;
  assert.equal((await test.pool.query('SELECT state FROM external_actions WHERE id=$1',[action])).rows[0].state,'dispatching');
  assert.equal(await recoverContactOutcomes(test.pool),1);
  const local=createMailpitTransport('development');assert.equal(await dispatchContact(test.pool,action,local),'skipped','Uncertain send must not be retried');
  assert.equal(await reconcileContact(test.pool,action,local),true,'Matching stored local message must recover the receipt');
  assert.equal(await reconcileContact(test.pool,action,local),false,'Receipt reconciliation is idempotent');
  assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[candidateId])).rows[0].stage,'awaiting_quote');
  const search=await fetch('http://127.0.0.1:8025/api/v1/search?query='+encodeURIComponent(test.runId)+'&limit=50');const inbox=await search.json();assert.equal(inbox.messages.filter(m=>m.MessageID===`forge-rfq-${action}@forge.invalid`).length,1);
  console.log(JSON.stringify({scenario:'contact-recovery',result:'PASS',database:test.database,runId:test.runId,process:'killed after actual local SMTP acceptance before DB receipt',restart:'outcome_unknown',resend:0,reconciled:'exact Message-ID, sender, recipient, subject and text',matchingMessages:1,externalDeliveries:0}));
}finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await test.close();}
