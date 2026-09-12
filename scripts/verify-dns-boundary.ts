import assert from 'node:assert/strict';
import {resolveApprovedTarget} from '../packages/security/src/egress.ts';
import {isAllowedAddress} from '../packages/security/src/ip-policy.ts';
let calls=0;
const approved=await resolveApprovedTarget('https://api.example.com/v1?q=test',{'api.example.com':true},async()=>{calls++;return [{address:'8.8.8.8',family:4}];});
assert.equal(approved.ok,true);if(approved.ok){assert.equal(approved.target.address,'8.8.8.8');assert.equal(approved.target.hostname,'api.example.com');assert.equal(approved.target.path,'/v1?q=test');assert.equal(Object.isFrozen(approved.target),true);}
assert.equal(calls,1);
assert.equal((await resolveApprovedTarget('https://api.example.com/',{'api.example.com':true},async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])).ok,false);
assert.equal((await resolveApprovedTarget('https://api.example.com/',{'api.example.com':true},async()=>[{address:'::ffff:7f00:1',family:6}])).ok,false);
assert.equal((await resolveApprovedTarget('https://api.example.com/',{'api.example.com':true},async()=>[])).ok,false);
assert.equal((await resolveApprovedTarget('https://127.0.0.1/',{'127.0.0.1':true},async()=>{calls++;return [];})).ok,false);assert.equal(calls,1);
assert.equal(isAllowedAddress('2606:4700:4700::1111'),true);
assert.equal(isAllowedAddress('8.8.8.8'),true);assert.equal(isAllowedAddress('172.32.0.1'),true);assert.equal(isAllowedAddress('100.128.0.1'),true);
assert.equal(isAllowedAddress('2002:7f00:1::'),false);assert.equal(isAllowedAddress('64:ff9b::7f00:1'),false);
console.log('PASS: DNS public-only result pin, mixed/private/empty DNS denial, and no DNS before authorization. Resolver fixtures only; no network.');
