import assert from 'node:assert/strict';
import {openAcceptance} from './support/acceptance.mjs';
import {subscriptionCapabilities,requireSubscriptionAuthorization,SubscriptionNotAuthorized} from '../packages/integrations/src/subscriptions/capabilities.ts';
const test=await openAcceptance();
try {
 assert.ok(Object.isFrozen(subscriptionCapabilities));
 assert.deepEqual(subscriptionCapabilities.map(c=>c.provider),['chatgpt','grok']);
 for(const capability of subscriptionCapabilities){
  assert.equal(capability.clientId,null);assert.equal(capability.allowedUse,null);assert.deepEqual(capability.scopes,[]);
  assert.throws(()=>requireSubscriptionAuthorization(capability.provider),SubscriptionNotAuthorized);
  const denied=await test.call(`/api/subscriptions/${capability.provider}/authorize`,{});
  assert.equal(denied.status,403);assert.equal(denied.body.code,'SUBSCRIPTION_NOT_AUTHORIZED');
  assert.equal(denied.body.url,undefined);
  assert.equal((await test.call(`/api/subscriptions/${capability.provider}/authorize`,{status:'authorized',clientId:'forged'})).status,400);
 }
 const status=await test.call('/api/subscriptions');assert.equal(status.status,200);assert.ok(status.body.capabilities.every(c=>c.status==='not_authorized'));
 console.log(JSON.stringify({scenario:'subscription-guard',result:'PASS',providers:['chatgpt','grok'],authorization:'denied',clientIds:0,loginUrls:0,adapters:'not installed or imported'}));
}finally{await test.close();}
