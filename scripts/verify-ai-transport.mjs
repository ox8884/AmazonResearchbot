import assert from 'node:assert/strict';
import {createAiTransport} from '../packages/integrations/src/ai/transport.ts';
let resolutions=0,wires=0;
const input={baseUrl:'https://model.fixture.invalid/v1/',model:'synthetic-model',apiKey:'SYNTHETIC_TRANSPORT_KEY_7392',maxInputTokens:1024,maxOutputTokens:256,messages:[{role:'user',content:'Return only this JSON object: {"forge_test":"ok"}.'}]};
const dependencies={resolver:async()=>{resolutions++;return [{address:'8.8.8.8',family:4}];},request:async(target,request)=>{
 wires++;assert.equal(target.address,'8.8.8.8');assert.equal(target.hostname,'model.fixture.invalid');assert.equal(target.path,'/v1/chat/completions');assert.equal(request.headers.authorization,'Bearer '+input.apiKey);
 const body=JSON.parse(request.body);assert.equal(body.max_tokens,256);assert.equal(body.stream,false);assert.deepEqual(body.messages,input.messages);
 return {status:200,body:{choices:[{message:{content:'{"forge_test":"ok"}'}}]},retryAfter:null};
}};
assert.deepEqual(createAiTransport(false,dependencies),{kind:'disabled'});assert.equal(resolutions,0);assert.equal(wires,0);
const ready=createAiTransport(true,dependencies);assert.equal(ready.kind,'ready');
assert.equal((await ready.send(input)).kind,'response');assert.equal(wires,1);
for(const baseUrl of ['http://model.fixture.invalid','https://user:pass@model.fixture.invalid/v1','https://model.fixture.invalid/v1?key=secret','https://model.fixture.invalid/v1#secret','https://model.fixture.invalid:8443/v1']){
 assert.equal((await ready.send({...input,baseUrl})).kind,'not_sent');
}
assert.equal((await ready.send({...input,apiKey:'key\r\nInjected: secret'})).kind,'not_sent');
assert.equal((await ready.send({...input,maxInputTokens:1})).kind,'not_sent');assert.equal(wires,1);assert.equal(resolutions,1);
const privateDns=createAiTransport(true,{...dependencies,resolver:async()=>[{address:'127.0.0.1',family:4}]});assert.equal((await privateDns.send(input)).kind,'not_sent');
const mixedDns=createAiTransport(true,{...dependencies,resolver:async()=>[{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}]});assert.equal((await mixedDns.send(input)).kind,'not_sent');assert.equal(wires,1);
let redirects=0;const redirect=createAiTransport(true,{...dependencies,request:async()=>{redirects++;return {status:302,body:null,retryAfter:null};}});assert.equal((await redirect.send(input)).status,302);assert.equal(redirects,1,'Redirect response must not cause a follow-up request');
const failed=createAiTransport(true,{...dependencies,request:async()=>{throw new Error(input.apiKey);}});const outcome=await failed.send(input);assert.equal(outcome.kind,'unknown');assert.ok(!JSON.stringify(outcome).includes(input.apiKey));
console.log(JSON.stringify({scenario:'ai-transport',result:'PASS',disabledNoDns:true,httpsAndHeaderGuard:true,dnsPinned:true,mixedPrivateDnsBlocked:true,redirectNotFollowed:true,uncertainResultHeld:true,errorsRedacted:true,realNetworkCalls:0}));
