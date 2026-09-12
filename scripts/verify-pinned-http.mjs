import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {pinnedJsonRequest} from '../packages/security/src/pinned-http.ts';
const original=https.request;let calls=0,options;
const target={hostname:'api.example.com',address:'8.8.8.8',family:4,path:'/v1/test',origin:'https://api.example.com'};
try{
  https.request=(input,callback)=>{calls++;options=input;const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=302;response.headers={location:'https://127.0.0.1/'};response.destroy=()=>{};callback(response);response.emit('data',Buffer.from('{"redirect":true}'));response.emit('end');});return request;};
  const result=await pinnedJsonRequest(target,{method:'POST',headers:{authorization:'Bearer synthetic'},body:'{}'});
  assert.equal(calls,1);assert.equal(result.status,302);assert.equal(options.hostname,'8.8.8.8');assert.equal(options.headers.host,'api.example.com');assert.equal(options.servername,'api.example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
  assert.ok(options.checkServerIdentity('ignored',{subject:{CN:'wrong.example'},subjectaltname:'DNS:wrong.example'}) instanceof Error);
  await assert.rejects(pinnedJsonRequest({...target,address:'127.0.0.1'},{method:'GET',headers:{}}));assert.equal(calls,1);
  await assert.rejects(pinnedJsonRequest(target,{method:'GET',headers:{cookie:'secret'}}));assert.equal(calls,1);
  await assert.rejects(pinnedJsonRequest(target,{method:'GET',headers:{authorization:'synthetic\r\nInjected: x'}}));assert.equal(calls,1);
  console.log('PASS: pinned IP, original Host/SNI/certificate identity, no proxy/global agent, no redirect follow or unsafe header/private target. HTTPS mock only.');
}finally{https.request=original;}
