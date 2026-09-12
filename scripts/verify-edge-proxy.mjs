import assert from 'node:assert/strict';
import {handleEdgeRequest} from '../apps/edge/src/index.ts';
let apiCalls=0,assetCalls=0;
const secret='SYNTHETIC_ACCESS_SECRET_7392';
const env={ASSETS:{fetch:async()=>{assetCalls++;return new Response('<main>SPA</main>',{headers:{'content-type':'text/html'}});}},PUBLIC_ORIGIN:'https://app.example.com',API_ORIGIN:'https://api.example.com',ACCESS_CLIENT_ID:'synthetic-client-id',ACCESS_CLIENT_SECRET:secret};
const proxy=async(url,init)=>{apiCalls++;assert.equal(url.origin,env.API_ORIGIN);assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');assert.equal(init.headers.get('CF-Access-Client-Secret'),secret);assert.equal(init.headers.get('CF-Access-Client-Id'),env.ACCESS_CLIENT_ID);assert.equal(init.headers.has('x-forwarded-for'),false);return new Response(JSON.stringify({path:url.pathname,query:url.search,method:init.method,cookie:init.headers.get('cookie'),body:init.body?await new Response(init.body).text():null}),{status:201,headers:{'cache-control':'public,max-age=3600','set-cookie':'session=synthetic; HttpOnly; Secure; SameSite=Lax; Path=/','CF-Access-Client-Secret':secret}});};
let response=await handleEdgeRequest(new Request(env.PUBLIC_ORIGIN+'/candidates/one'),env,proxy);assert.equal(response.status,200);assert.equal(assetCalls,1);assert.equal(apiCalls,0);
response=await handleEdgeRequest(new Request(env.PUBLIC_ORIGIN+'/api/items?target=https://evil.invalid',{method:'POST',headers:{origin:env.PUBLIC_ORIGIN,cookie:'session=old','content-type':'application/json','CF-Access-Client-Secret':'spoof','x-forwarded-for':'spoof'},body:'{"synthetic":true}'}),env,proxy);
assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.has('CF-Access-Client-Secret'),false);assert.match(response.headers.get('set-cookie'),/session=synthetic/);assert.deepEqual(await response.json(),{path:'/api/items',query:'?target=https://evil.invalid',method:'POST',cookie:'session=old',body:'{"synthetic":true}'});
const before=apiCalls;
for(const request of [new Request(env.PUBLIC_ORIGIN+'/api/items',{method:'POST'}),new Request(env.PUBLIC_ORIGIN+'/api/items',{headers:{origin:'https://evil.invalid'}}),new Request(env.PUBLIC_ORIGIN+'/api/items',{method:'PROPFIND'})])assert.ok((await handleEdgeRequest(request,env,proxy)).status>=400);
assert.equal(apiCalls,before);
for(const origin of ['http://api.example.com','https://127.0.0.1','https://[::1]','https://name:password@api.example.com','https://api.example.com/path','https://api.example.com?x=1',env.PUBLIC_ORIGIN])assert.equal((await handleEdgeRequest(new Request(env.PUBLIC_ORIGIN+'/api'),{...env,API_ORIGIN:origin},proxy)).status,503);
assert.equal(apiCalls,before);
response=await handleEdgeRequest(new Request(env.PUBLIC_ORIGIN+'/api'),env,async()=>new Response(null,{status:302,headers:{location:'https://evil.invalid'}}));assert.equal(response.status,502);assert.equal(response.headers.has('location'),false);assert.equal(response.headers.get('cache-control'),'no-store');
response=await handleEdgeRequest(new Request(env.PUBLIC_ORIGIN+'/api'),env,async()=>{throw new Error(secret);});assert.equal(response.status,502);assert.equal((await response.text()).includes(secret),false);
console.log(JSON.stringify({scenario:'edge-proxy',result:'PASS',assetCalls,apiCalls,fixedOrigin:true,noStore:true,cookiesPreserved:true,redirectDenied:true,secretNotReturned:true,cloudflareRuntimeVerified:false}));

const {createServer}=await import('node:http');
const {once}=await import('node:events');
const {default: worker}=await import('../apps/edge/src/index.ts');
let wireCalls=0;
const server=createServer(async(req,res)=>{
 wireCalls++;
 assert.equal(req.headers['cf-access-client-secret'],secret);
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 res.writeHead(200,{'content-type':'application/json','set-cookie':['session=new; HttpOnly; Secure; Path=/','trusted=device; HttpOnly; Secure; Path=/']});
 res.end(JSON.stringify({url:req.url,body:Buffer.concat(chunks).toString(),cookie:req.headers.cookie}));
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();assert.ok(address&&typeof address==='object');
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=async(url,init)=>{
  assert.equal(url.origin,env.API_ORIGIN);
  const local=new URL('http://127.0.0.1:'+address.port);
  local.pathname=url.pathname;local.search=url.search;
  return originalFetch(local,{...init,duplex:'half'});
 };
 response=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/api/auth/sign-in/email',{
  method:'POST',headers:{origin:env.PUBLIC_ORIGIN,cookie:'session=old','content-type':'application/json'},body:'{"synthetic":true}'
 }),env,{waitUntil(){throw new Error('ExecutionContext must not be used as fetch');}});
 assert.equal(response.status,200);
 assert.equal(response.headers.getSetCookie().length,2);
 assert.deepEqual(await response.json(),{url:'/api/auth/sign-in/email',body:'{"synthetic":true}',cookie:'session=old'});
 assert.equal(wireCalls,1);
 console.log(JSON.stringify({scenario:'edge-http',result:'PASS',wireCalls,cookies:2,workerEntrypoint:true,realCloudflare:false}));
}finally{globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
