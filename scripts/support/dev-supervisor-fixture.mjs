import assert from 'node:assert/strict';
import {spawn as spawnChild} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {startOptionalBrowserClient} from './dev-browser-client.mjs';

export async function openDevSupervisorFixture({root,source,exitedCore=false}){
 const code=await readFile(path.join(root,'scripts/dev.mjs'),'utf8');
 const start=code.indexOf('const children = [');
 assert.ok(start>=0,'Supervisor child setup must exist');
 const signalSource=new EventEmitter();
 Object.assign(signalSource,{execPath:process.execPath,platform:process.platform,env:source});
 const core=[],exits=[],ready=[];let browser,finished=false,handlersReady;
 const handlers=new Promise(resolve=>{handlersReady=resolve;});
 const on=signalSource.on.bind(signalSource);
 signalSource.on=(name,listener)=>{on(name,listener);if(signalSource.listenerCount('SIGTERM')&&signalSource.listenerCount('SIGINT'))handlersReady();return signalSource;};
 const spawn=()=>{
  const childCode=exitedCore&&core.length===0?"process.send({kind:'ready'},()=>process.exit(0));":"process.send({kind:'ready'});process.on('message',m=>{if(m.kind==='ping')process.send({kind:'pong',id:m.id});});setInterval(()=>{},1000);";
  const child=spawnChild(process.execPath,['-e',childCode],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,NODE_OPTIONS:''}});
  core.push(child);
  exits.push(new Promise(resolve=>{child.once('error',resolve);child.once('close',resolve);}));
  ready.push(new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('CORE_FIXTURE_START_TIMEOUT')),10000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   const receive=message=>{if(message.kind==='ready'){clearTimeout(timer);child.off('message',receive);resolve();}};child.on('message',receive);
  }));
  return child;
 };
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('spawn','process','root','startOptionalBrowserClient','console',code.slice(start));
 const running=run(spawn,signalSource,root,async options=>{if(exitedCore){await Promise.all(ready);await exits[0];}browser=await startOptionalBrowserClient({...options,stdio:['ignore','pipe','pipe'],onAttention:()=>{}});return browser;},{log:()=>{}});
 void running.then(()=>{finished=true;});
 await handlers;await Promise.all(ready);
 async function coreAlive(){
  assert.equal(finished,false,'Optional exit must not resolve the core race');
  await Promise.all(core.map((child,index)=>new Promise((resolve,reject)=>{
   const id='supervisor-ping-'+index;
   const timer=setTimeout(()=>reject(new Error('CORE_FIXTURE_NO_RESPONSE')),3000);
   const receive=message=>{if(message.kind==='pong'&&message.id===id){clearTimeout(timer);child.off('message',receive);resolve();}};
   child.on('message',receive);child.send({kind:'ping',id},error=>{if(error){clearTimeout(timer);child.off('message',receive);reject(error);}});
  })));
  assert.equal(finished,false,'Core children must remain supervised');
 }
 async function close(){
  signalSource.emit('SIGTERM');
  await running;await Promise.all(exits);if(browser)await browser.closed;
  assert.ok(core.every(child=>child.exitCode!==null||child.signalCode!==null),'Shutdown must close every core stand-in');
  if(browser)assert.ok(browser.child.exitCode!==null||browser.child.signalCode!==null,'Shutdown must close the optional client');
 }
 return {browser,coreAlive,close,finished:running,coreCount:core.length,signalBoundary:'Node SIGTERM event; native console delivery not emulated'};
}
