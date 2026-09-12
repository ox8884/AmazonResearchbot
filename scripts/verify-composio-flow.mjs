import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {openAcceptance} from './support/acceptance.mjs';
import {registerComposioRoutes} from '../apps/api/src/composio-routes.ts';
import {loadEnv} from '../apps/api/src/env.ts';
import {createComposioRequest} from '../apps/api/src/composio-client.ts';
const parsedEnv=loadEnv({DATABASE_URL:'postgres://fixture',BETTER_AUTH_SECRET:'a'.repeat(32),ENCRYPTION_KEY:'79'.repeat(32),COMPOSIO_API_KEY:'  MCP_SENTINEL_KEY  ',BOOTSTRAP_EMAIL:'owner@fixture.invalid'});assert.equal(parsedEnv.composioApiKey,'MCP_SENTINEL_KEY');assert.equal(parsedEnv.composioOwnerEmail,'owner@fixture.invalid');
const test=await openAcceptance({databaseKey:'composio-mcp-'+Date.now()});
const user=(await test.call('/api/session')).body.user.id;
let accounts=[],links=0,actionCalls=0,unsafe=false;
const server=createServer(async(req,res)=>{
 assert.equal(req.headers['x-consumer-api-key'],'MCP_SENTINEL_KEY');assert.equal(req.headers['x-api-key'],undefined);
 const chunks=[];for await(const c of req)chunks.push(c);const p=JSON.parse(Buffer.concat(chunks).toString());
 if(p.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
 let result;
 if(p.method==='initialize'){result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};res.setHeader('mcp-session-id','fixture-http-session');}
 else{assert.equal(req.headers['mcp-session-id'],'fixture-http-session');assert.equal(p.method,'tools/call');assert.equal(p.params.name,'COMPOSIO_MANAGE_CONNECTIONS');const [{name,action}]=p.params.arguments.toolkits;assert.equal(name,'gmail');assert.ok(['list','add'].includes(action));actionCalls++;
 const gmail=action==='list'?{toolkit:'gmail',status:'active',accounts}:{toolkit:'gmail',status:'initiated',redirect_url:unsafe?'https://attacker.invalid/link/ln_fake':'https://connect.composio.dev/link/ln_fixture'};if(action==='add')links++;
 result={content:[{type:'text',text:JSON.stringify({successful:true,error:null,data:{results:{gmail}}})}],isError:false};}
 res.setHeader('content-type','text/event-stream');res.end('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:p.id,result})+'\n\n');
});server.listen(0,'127.0.0.1');await once(server,'listening');
const wire=async input=>{const r=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',headers:input.headers,body:input.body});return {status:r.status,body:await r.text(),mcpSessionId:r.headers.get('mcp-session-id')??undefined};};
const remote=createComposioRequest('MCP_SENTINEL_KEY',wire);
let actingUser=user;const app=Fastify();app.addHook('preHandler',async req=>{req.userId=actingUser;});registerComposioRoutes(app,test.pool,Buffer.from('79'.repeat(32),'hex'),{apiKey:'MCP_SENTINEL_KEY',ownerEmail:test.authFixture.email,request:remote});
const post=path=>app.inject({method:'POST',url:path,payload:{}});
try{
 await test.pool.query("INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'test',snapshot||'{\"summaryEmail\":\"expected@fixture.invalid\"}'::jsonb FROM settings_versions ORDER BY version DESC LIMIT 1");
 let result=await post('/api/connections/gmail/connect');assert.equal(result.statusCode,200);assert.equal(result.json().redirectUrl,'https://connect.composio.dev/link/ln_fixture');assert.equal(links,1);
 result=await post('/api/connections/gmail/connect');assert.equal(result.statusCode,200);assert.equal(links,1,'Pending link is reused');
 accounts=[{id:'wrong',status:'active',is_default:true,alias:'expected@fixture.invalid',user_info:{emailAddress:'other@fixture.invalid'}},{id:'correct',status:'active',is_default:false,user_info:{emailAddress:'expected@fixture.invalid'}}];
 result=await post('/api/connections/gmail/refresh');assert.equal(result.statusCode,200);assert.equal(result.json().status,'active');assert.equal(result.json().email,'expected@fixture.invalid');
 const row=(await test.pool.query('SELECT * FROM composio_gmail_connections WHERE user_id=$1',[user])).rows[0];assert.equal(row.account_id,'correct');assert.ok(!row.session_ciphertext.includes('fixture-http-session'));
 accounts=accounts.slice(0,1);result=await post('/api/connections/gmail/refresh');assert.equal(result.json().status,'mismatch');assert.equal(result.json().email,null,'Other mailbox identity is not exposed');
 unsafe=true;result=await post('/api/connections/gmail/connect');assert.equal(result.statusCode,502);
 assert.ok(!result.body.includes('MCP_SENTINEL_KEY'));
 const before=actionCalls;actingUser='not-the-owner';assert.equal((await post('/api/connections/gmail/connect')).statusCode,403);assert.equal(actionCalls,before);actingUser=user;
 console.log(JSON.stringify({scenario:'composio-mcp',result:'PASS',streamableHttp:true,consumerHeader:true,sessionHeader:true,exactMailboxSelection:true,wrongAliasIgnored:true,unsafeRedirectRejected:true,mailReadOrSendCalls:0,actionCalls,externalCalls:0}));
}finally{await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));await test.close();}
