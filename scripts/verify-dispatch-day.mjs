import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {executeJsQuery} from '../packages/integrations/src/jungle-scout/execute.ts';
import {createSimulatorTransport} from '../packages/integrations/src/jungle-scout/transport.ts';
const test=await openAcceptance({databaseKey:'dispatch-day-'+Date.now()});
let hits=0,advanced=false;
const before=new Date('2111-01-01T23:59:59.900Z'),after=new Date('2111-01-02T00:00:00.100Z');
const server=createServer(async(req,res)=>{for await(const chunk of req)void chunk;hits++;res.writeHead(200,{'content-type':'application/json'});res.end('{"data":[]}');});
server.listen(0,'127.0.0.1');await once(server,'listening');
const fakeClockPool=new Proxy(test.pool,{get(target,key){
 if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,member){
  if(member==='query')return (sql,...args)=>{
   if(sql==='SELECT clock_timestamp() AS dispatched_at')return Promise.resolve({rows:[{dispatched_at:advanced?after:before}],rowCount:1});
   if(sql==='SELECT clock_timestamp() AS rate_at'){advanced=true;return Promise.resolve({rows:[{rate_at:after}],rowCount:1});}
   return connection.query(sql,...args);
  };
  const value=Reflect.get(connection,member);return typeof value==='function'?value.bind(connection):value;
 }});};
 const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
}});
try{
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'dispatch-day-fixture',jsonb_set(snapshot,'{jsDailyWireCap}','3'::jsonb) FROM settings_versions ORDER BY version DESC LIMIT 1");
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const transport=createSimulatorTransport(`http://127.0.0.1:${address.port}`,'development');
 const input={endpoint:'product_database_query',marketplace:'us',query:{midnight:test.runId},accountScope:'midnight:'+test.runId,wireLimit:3};
 const first=await executeJsQuery(fakeClockPool,transport,input);
 assert.equal(first.kind,'deferred','A UTC rollover while acquiring the dispatch locks must not use the old day');
 assert.equal(hits,0);assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM api_attempts')).rows[0].n,0);
 assert.equal((await test.pool.query("SELECT COALESCE(sum(reserved+consumed),0)::int AS n FROM budget_days WHERE day_utc='2111-01-01'")).rows[0].n,0);
 assert.equal((await executeJsQuery(fakeClockPool,transport,input)).kind,'succeeded');assert.equal(hits,1);
 assert.deepEqual((await test.pool.query("SELECT reserved,consumed FROM budget_days WHERE day_utc='2111-01-02'")).rows[0],{reserved:0,consumed:1});
 console.log(JSON.stringify({scenario:'dispatch-day',result:'PASS',database:test.database,rolloverWireCount:0,nextDayWireCount:1,oldDayCharged:0,externalCalls:0}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await test.close();}
