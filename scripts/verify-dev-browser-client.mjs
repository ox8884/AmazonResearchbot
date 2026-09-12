import {openDevSupervisorFixture} from './support/dev-supervisor-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {startOptionalBrowserClient} from './support/dev-browser-client.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=await mkdtemp(path.join(tmpdir(),'forge-dev-bridge-'));
const server=createServer((_request,response)=>response.end('core-alive'));
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const source={...process.env,APP_ENV:'development',WEB_ORIGIN:origin,BROWSER_BRIDGE_CONFIG:path.join(directory,'config.json'),NODE_OPTIONS:'--require=definitely-missing-untrusted-startup.cjs',ENCRYPTION_KEY:'SYNTHETIC_ENV_SENTINEL'};
const attention=[];let client;
try{
 assert.equal(await startOptionalBrowserClient({root,source,onAttention:code=>attention.push(code),stdio:['ignore','pipe','pipe']}),null);
 await writeFile(source.BROWSER_BRIDGE_CONFIG,JSON.stringify({origin,deviceId:randomUUID(),publicKey:browserSigningFixture().publicKey.export({format:'pem',type:'spki'}).toString(),directory:path.join(directory,'state'),cliPath:'unused',accountId:'u0'}));
 client=await startOptionalBrowserClient({root,source,onAttention:code=>attention.push(code),stdio:['ignore','pipe','pipe']});
 assert.ok(client,'A configured client must be started');
 let stderr='';client.child.stderr.on('data',chunk=>{stderr+=chunk;});
 const result=await client.closed;
 assert.equal(result.code,1,'The actual client rejects this deliberately missing vault credential');
 assert.ok(stderr.includes('Browser bridge could not start'),'NODE_OPTIONS must not hijack the child before its actual entrypoint');
 assert.equal(stderr.includes('SYNTHETIC_ENV_SENTINEL'),false);
 assert.deepEqual(attention,['BROWSER_CLIENT_EXITED']);
 assert.equal(await (await fetch(origin)).text(),'core-alive','Optional client failure must leave the core process alive');
 const supervisor=await openDevSupervisorFixture({root,source});
 try{
  supervisor.browser.child.stderr.resume();supervisor.browser.child.stdout.resume();
  assert.equal((await supervisor.browser.closed).code,1);
  assert.equal(supervisor.coreCount,4);await supervisor.coreAlive();
 }finally{await supervisor.close();}
 const endedSupervisor=await openDevSupervisorFixture({root,source,exitedCore:true});
 let timeout;
 try{await Promise.race([endedSupervisor.finished,new Promise((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('CORE_EXIT_EVENT_LOST_DURING_OPTIONAL_START')),1000);})]);}
 finally{clearTimeout(timeout);await endedSupervisor.close();}
 await writeFile(source.BROWSER_BRIDGE_CONFIG,JSON.stringify({origin:'https://different.fixture.invalid'}));
 assert.equal(await startOptionalBrowserClient({root,source,onAttention:code=>attention.push(code)}),null);
 assert.equal(attention.at(-1),'BROWSER_CLIENT_CONFIGURATION_REJECTED');
 const remote=await startOptionalBrowserClient({root,source:{...source,WEB_ORIGIN:'https://different.fixture.invalid'},onAttention:code=>attention.push(code),stdio:['ignore','pipe','pipe']});
 if(remote){remote.child.kill();await remote.closed;}
 assert.ok(remote===null,'A development supervisor cannot launch a remote-origin client');
 await assert.rejects(startOptionalBrowserClient({root,source:{...source,APP_ENV:'production'}}),/LOCAL_BROWSER_DEVELOPMENT_ONLY/);
 console.log(JSON.stringify({scenario:'dev-browser-client',result:'PASS',unconfiguredSkipped:true,actualChildStarted:true,nodeOptionsNotForwarded:true,optionalFailureDoesNotStopCore:true,actualSupervisorTail:true,alreadyExitedCoreRecognized:true,coreStandInsClosedBySignalHandler:true,originMismatchRejected:true,productionRejected:true,externalCalls:0}));
}finally{
 if(client&&client.child.exitCode===null&&client.child.signalCode===null){client.child.kill();await client.closed;}
 await new Promise(resolve=>server.close(resolve));
 assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('forge-dev-bridge-'));
 await rm(directory,{recursive:true,force:true});
}
