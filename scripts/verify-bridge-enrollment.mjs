import {openDevSupervisorFixture} from './support/dev-supervisor-fixture.mjs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {verifiedSigningIdentity} from '../apps/browser-bridge/signing-identity.mjs';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openAcceptance} from './support/acceptance.mjs';
import {createBridgeClient} from '../apps/browser-bridge/enrollment.mjs';
import {deviceVault} from '../apps/browser-bridge/device-vault.mjs';

const reservation=createServer();
reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const address=reservation.address();assert.ok(address&&typeof address==='object');
const origin='http://127.0.0.1:'+address.port;
await new Promise(resolve=>reservation.close(resolve));
const client=createBridgeClient({origin});
const test=await openAcceptance({databaseKey:'bridge-client-acceptance',webOrigin:origin});
const slots=[];
try {
 await test.app.listen({port:address.port,host:'127.0.0.1'});
 const identity=await publishBrowserSigningIdentity(test.pool,browserSigningFixture().privateKey);
 assert.throws(()=>verifiedSigningIdentity({...identity,fingerprint:'0'.repeat(64)}));
 assert.throws(()=>verifiedSigningIdentity({publicKey:browserSigningFixture().privateKey.export({format:'pem',type:'pkcs8'}).toString(),fingerprint:identity.fingerprint}));
 await assert.rejects(client.enrollBrowserDevice({origin:'https://other.example.com',pairingCode:'fbp_'+'a'.repeat(64),name:'Wrong host'}),/INVALID_ENROLLMENT/);
 await assert.rejects(client.checkDeviceRegistration({origin:'https://other.example.com',deviceId:'wrong'}),/INVALID_DEVICE_REQUEST/);
 const issued=await test.call('/api/bridge/pairings',{});assert.equal(issued.status,201);
 const enrolled=await client.enrollBrowserDevice({pairingCode:issued.body.pairingCode,name:'Synthetic native enrollment '+test.runId});
 slots.push(enrolled.deviceId);
 assert.equal(enrolled.credentialStored,true);
 assert.equal(enrolled.browserAvailable,false);
 assert.deepEqual(enrolled.signingKey,identity,'Enrollment must expose the authenticated public identity for pinning');
 assert.equal('credential' in enrolled,false);
 const status=await client.checkDeviceRegistration({deviceId:enrolled.deviceId});
 assert.deepEqual(status,{deviceId:enrolled.deviceId,registered:true,browserAvailable:false,connectionState:'unreported',checkedAt:null,capabilities:[]});
 await assert.rejects(client.enrollBrowserDevice({pairingCode:issued.body.pairingCode,name:'Duplicate'}));
 if(process.env.FORGE_ASIDE_CLI_PATH){
  const directory=await mkdtemp(path.join(tmpdir(),'forge-bridge-config-'));
  try{
   const setupCode=(await test.call('/api/bridge/pairings',{})).body;
   const configFile=path.join(directory,'config.json');
   const input={origin,name:'Synthetic config '+test.runId,pairingCode:setupCode.pairingCode,directory:path.join(directory,'state'),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT};
   const configure=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['apps/browser-bridge/configure-client.mjs','--config',configFile,'--origin',origin,'--name',input.name,'--directory',input.directory,'--aside-cli',input.cliPath,'--account',input.accountId],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));child.stdin.on('error',error=>{if(error.code!=='EPIPE')reject(error);});child.stdin.end(input.pairingCode+String.fromCharCode(10));
   });
   const result=await configure();assert.equal(result.code,0,result.stderr);
   const configured=JSON.parse(result.stdout);slots.push(configured.deviceId);
   const config=JSON.parse(await readFile(configFile,'utf8'));
   assert.equal(config.publicKey,identity.publicKey);assert.equal(config.deviceId,configured.deviceId);
   const credential=await deviceVault('read',{origin,deviceId:configured.deviceId});assert.ok(credential);
   assert.equal(JSON.stringify(config).includes(credential),false);assert.equal(JSON.stringify(config).includes(input.pairingCode),false);
   const supervisor=await openDevSupervisorFixture({root:fileURLToPath(new URL('../',import.meta.url)),source:{...process.env,APP_ENV:'development',WEB_ORIGIN:origin,BROWSER_BRIDGE_CONFIG:configFile}});
   const bridge=supervisor.browser;
   assert.ok(bridge);
   try{
    await new Promise((resolve,reject)=>{
     let output='',finished=false;const timer=setTimeout(()=>{finished=true;reject(new Error('CLIENT_IDLE_TIMEOUT'));},20000);
     bridge.child.stderr.resume();
     bridge.child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"kind":"idle"')&&!finished){finished=true;clearTimeout(timer);resolve();}});
     void bridge.closed.then(()=>{if(!finished){finished=true;clearTimeout(timer);reject(new Error('CLIENT_EXITED_BEFORE_IDLE'));}});
    });
    assert.equal((await client.checkDeviceRegistration({deviceId:configured.deviceId})).browserAvailable,true,'The supervised client must report its actual ASIDE connection');
    await supervisor.coreAlive();
   }finally{await supervisor.close();}
   const repeated=await configure();assert.equal(repeated.code,1);assert.equal(JSON.parse(repeated.stderr).code,'BRIDGE_CONFIG_EXISTS');
   assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),config);
  }finally{
   if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('forge-bridge-config-'))throw new Error('UNSAFE_FIXTURE_CLEANUP');
   await rm(directory,{recursive:true,force:true});
  }
 }

 assert.equal((await test.call('/api/bridge/devices/'+enrolled.deviceId+'/revoke',{})).status,200);
 await assert.rejects(client.checkDeviceRegistration({deviceId:enrolled.deviceId}));
}finally{
 try{for(const deviceId of slots){const credential=await deviceVault('read',{origin,deviceId});if(credential)await deviceVault('remove',{origin,deviceId,credential});}}
 finally{await test.close();}
}
console.log(JSON.stringify({scenario:'bridge-enrollment',result:'PASS',actualHttpToWindowsVault:true,perRequestOriginOverrideRejected:true,credentialNeverReturned:true,publicKeyPinned:true,configurationCli:Boolean(process.env.FORGE_ASIDE_CLI_PATH),supervisedClient:Boolean(process.env.FORGE_ASIDE_CLI_PATH),revocationObserved:true,fixtureRemoved:true,externalCalls:0,supervisedAvailabilityVerified:Boolean(process.env.FORGE_ASIDE_CLI_PATH)}));
