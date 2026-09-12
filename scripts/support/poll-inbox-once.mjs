import {recordInboxQuotes} from "../../apps/worker/src/inbox-quote-loop.ts";
import {createPool} from '../../packages/db/src/index.ts';
import {createInboxCycle} from '../../apps/worker/src/inbox-loop.ts';
import {createImapInboxClient} from '../../packages/integrations/src/mail/inbox-client.ts';
async function main(){
 const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
 const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(typeof input.databaseUrl!=='string'||typeof input.keyHex!=='string'||!/^[a-f0-9]{64}$/.test(input.keyHex)||typeof input.certificate!=='string'||!Number.isInteger(input.port)||input.port<1||input.port>65535)throw new Error('Invalid acceptance input');
 const target=new URL(input.databaseUrl);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/forge_ops_acceptance_[a-z0-9]+$/.test(target.pathname))throw new Error('Dedicated local acceptance database required');
 const pool=createPool(input.databaseUrl);
 try{
  const cycle=createInboxCycle(pool,Buffer.from(input.keyHex,'hex'),{mode:'profile',connector:{resolveHost:async()=>[{address:'8.8.8.8',family:4}],createClient:options=>createImapInboxClient({...options,host:'127.0.0.1',port:input.port,tls:{...options.tls,ca:Buffer.from(input.certificate,'base64')}})}});
  const collected=await cycle();
  const quotes=await recordInboxQuotes(pool,Buffer.from(input.keyHex,"hex"));
  process.stdout.write(JSON.stringify({...collected,quoteProcessing:quotes}));
 }finally{await pool.end();}
}
main().catch(()=>{process.stderr.write('Inbox acceptance child failed');process.exitCode=1;});
