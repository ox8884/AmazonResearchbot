import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
const test=await openAcceptance({databaseKey:'composio-gmail-'+Date.now()});
try {
 const initial=await test.call('/api/connections/gmail');assert.equal(initial.status,200);assert.equal(initial.body.configured,false);
 const connect=await test.call('/api/connections/gmail/connect',{});assert.equal(connect.status,503);assert.equal(connect.body.code,'COMPOSIO_NOT_CONFIGURED');
 assert.equal((await test.call('/api/connections/gmail/connect',{},{origin:'https://wrong.invalid'})).status,403);
 console.log('PASS: Gmail connection requires server credentials and authenticated origin.');
}finally{await test.close();}
