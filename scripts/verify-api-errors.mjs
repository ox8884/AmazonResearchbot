import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {openAcceptance} from './support/acceptance.mjs';
const {default:pino}=await import('../apps/api/node_modules/pino/pino.js');
const {PINO_REDACT_PATHS}=await import('../packages/security/src/logs.ts');
let captured='';
const headerLogger=pino({redact:{paths:PINO_REDACT_PATHS,censor:'[redacted]'}},{write(value){captured+=value;}});
headerLogger.info({req:{headers:{'cf-access-client-id':'SYNTHETIC_ACCESS_ID','cf-access-client-secret':'SYNTHETIC_ACCESS_SECRET','cf-access-jwt-assertion':'SYNTHETIC_ACCESS_JWT'}}},'header redaction check');
assert.equal(captured.includes('SYNTHETIC_ACCESS'),false);
assert.equal(JSON.parse(captured).req.headers['cf-access-client-secret'],'[redacted]');
captured='';
headerLogger.info({req:{body:{pairingCode:'SYNTHETIC_PAIR_CODE'}},device:{credential:'SYNTHETIC_DEVICE_CREDENTIAL'}},'pairing redaction check');
assert.equal(captured.includes('SYNTHETIC_PAIR_CODE'),false);
assert.equal(captured.includes('SYNTHETIC_DEVICE_CREDENTIAL'),false);
const test=await openAcceptance();
const originalQuery=test.pool.query.bind(test.pool);
const originalLog=test.app.log.error.bind(test.app.log);
const sentinel='SYNTHETIC_SECRET_MUST_NOT_LEAK';
const logged=[];
try {
 test.app.log.error=(...args)=>{logged.push(args);};
 test.pool.query=(...args)=>{
  if(typeof args[0]==='string'&&args[0].includes('FROM settings_versions'))return Promise.reject(new Error(sentinel));
  return originalQuery(...args);
 };
 const result=await test.call('/api/settings');
 assert.equal(result.status,500);
 assert.equal(result.body.code,'INTERNAL_ERROR');
 assert.equal(typeof result.body.requestId,'string');
 assert.equal(JSON.stringify(result.body).includes(sentinel),false);
 assert.equal(inspect(logged,{depth:8}).includes(sentinel),false);
 assert.deepEqual(Object.keys(result.body).sort(),['code','message','requestId']);
 test.pool.query=(...args)=>typeof args[0]==='string'&&args[0].includes('FROM settings_versions')
   ? Promise.resolve({rows:[],rowCount:0}) : originalQuery(...args);
 const missing=await test.call('/api/settings');
 assert.equal(missing.status,500,'Missing settings must not silently become initial defaults');
 assert.equal(missing.body.snapshot,undefined);

 console.log(JSON.stringify({scenario:'api-error-boundary',result:'PASS',responseLeak:false,loggedErrorLeak:false}));
}finally{test.pool.query=originalQuery;test.app.log.error=originalLog;await test.close();}
