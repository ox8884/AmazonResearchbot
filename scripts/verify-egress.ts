import assert from 'node:assert/strict';
import { authorizeUrl } from '../packages/security/src/egress.ts';
const denied=['https://[::1]/','https://[::ffff:127.0.0.1]/','https://[fc00::1]/','https://[fe80::1]/','https://[2001:db8::1]/','https://[3fff::1]/','https://127.1/','https://2130706433/','https://10.0.0.1/','https://100.64.0.1/','https://169.254.169.254/','https://172.31.255.255/','https://192.168.1.1/','https://192.0.2.1/','https://198.18.0.1/','https://198.51.100.1/','https://203.0.113.1/','https://224.0.0.1/','https://240.1.1.1/'];
for(const raw of denied){const host=new URL(raw).hostname;assert.equal(authorizeUrl(raw,{[host]:true}).ok,false,'Address must be denied: '+host);}
assert.equal(authorizeUrl('https://constructor/',{'allowed.example':true}).ok,false);
assert.equal(authorizeUrl('http://api.example.com/',{'api.example.com':true}).ok,false);
assert.equal(authorizeUrl('https://test:synthetic@api.example.com/',{'api.example.com':true}).ok,false);
assert.equal(authorizeUrl('https://api.example.com:8443/',{'api.example.com':true}).ok,false);
assert.equal(authorizeUrl('https://api.example.com/#fragment',{'api.example.com':true}).ok,false);
assert.equal(authorizeUrl('https://api.example.com/v1',{'api.example.com':true}).ok,true);
console.log('PASS: URL/IPv4/IPv6/prototype-host request boundaries; no network used.');
