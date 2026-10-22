import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

const execute=promisify(execFile),require=createRequire(import.meta.url);
const base='http://127.0.0.1:21420';
const permission={rules:{deny:[{type:'tool',tool:'*'}],default:'deny'},files:{outsideRead:'deny',outsideWrite:'deny'}};

async function nativeSigner(deadline){
 const powershell=path.join(process.env.SystemRoot??'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const {stdout}=await execute(powershell,['-NoProfile','-NonInteractive','-Command',
  "Get-CimInstance Win32_Process -Filter \"Name='aside-daemon.exe'\" | Select-Object -ExpandProperty ExecutablePath | Sort-Object -Unique"],
  {windowsHide:true,timeout:Math.max(1,Math.min(5000,deadline-Date.now())),maxBuffer:32768});
 const paths=stdout.trim().split(/\r?\n/).filter(Boolean);
 if(paths.length!==1)throw Error('AI_UNAVAILABLE');
 const executable=await realpath(paths[0]);
 const official=path.join(process.env.ProgramFiles??'C:/Program Files','Aside','Application');
 if(!/^[0-9.]+[\\/]AsideDaemon[\\/]win-x64[\\/]aside-daemon[.]exe$/i.test(path.relative(official,executable)))throw Error('AI_UNAVAILABLE');
 const nativePath=await realpath(path.join(path.dirname(executable),'native','aside-native.node'));
 if(path.dirname(nativePath).toLowerCase()!==path.join(path.dirname(executable),'native').toLowerCase())throw Error('AI_UNAVAILABLE');
 return require(nativePath);
}

export async function protectAsideSession(configuration,sessionId,deadline){
 try{
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)||!/^u\d+$/.test(configuration.accountId))throw Error('AI_UNAVAILABLE');
  const accountId=Number(configuration.accountId.slice(1));
  let token;
  async function request(route,init={}){
   const remaining=deadline-Date.now();
   if(remaining<=0)throw Error('AI_UNAVAILABLE');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(15000,remaining));
   try{
    const response=await fetch(base+route,{...init,redirect:'error',signal:controller.signal,
     headers:{'content-type':'application/json',...(token?{Authorization:'AsideDaemonSessionToken '+token}:{})}});
    if(!response.ok||!response.body)throw Error('AI_UNAVAILABLE');
    const chunks=[];let size=0;
    for await(const chunk of response.body){
     size+=chunk.length;if(size>4*1024*1024){controller.abort();throw Error('AI_UNAVAILABLE');}
     chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
   }finally{clearTimeout(timer);}
  }
  const binding=await nativeSigner(deadline);
  const challenge=await request('/auth/daemon/challenge?clientKind=cli');
  if(typeof challenge.challenge!=='string'||typeof challenge.challengeId!=='string')throw Error('AI_UNAVAILABLE');
  const input=Buffer.concat([Buffer.from('Aside Daemon Auth v1\0'),Buffer.from(challenge.challenge,'base64')]);
  const signed=JSON.parse(binding.run('cdp-sign',JSON.stringify({challenge:input.toString('base64')})));
  if(signed.error||typeof signed.signature!=='string')throw Error('AI_UNAVAILABLE');
  const auth=await request('/auth/daemon/session',{method:'POST',body:JSON.stringify({challengeId:challenge.challengeId,signedChallenge:signed.signature})});
  if(typeof auth.access_token!=='string'||!auth.access_token)throw Error('AI_UNAVAILABLE');
  token=auth.access_token;
  async function rpc(route,input,mutation=false){
   const result=await request('/trpc/'+route+(mutation?'':'?input='+encodeURIComponent(JSON.stringify(input))),
    mutation?{method:'POST',body:JSON.stringify(input)}:{});
   if(result.error||!result.result||!Object.hasOwn(result.result,'data'))throw Error('AI_UNAVAILABLE');
   return result.result.data;
  }
  const identity={accountId,sessionId};
  const defaultModel=await rpc('settings.get',{accountId,key:'defaultModel'});
  // The shipped RPC refreshes the loaded runtime; REPL Store.update does not.
  await rpc('sessions.update',{...identity,permission,runtimeConfig:{memoryExtractionDisabled:true}},true);
  const session=await rpc('sessions.get',identity);
  const rules=session?.permission?.rules,files=session?.permission?.files;
  if(session?.id!==sessionId||session.status!=='idle'||rules?.default!=='deny'||
   rules.deny?.length!==1||rules.deny[0].type!=='tool'||rules.deny[0].tool!=='*'||
   (rules.allow?.length??0)!==0||(rules.ask?.length??0)!==0||
   files?.outsideRead!=='deny'||files?.outsideWrite!=='deny'||session.runtimeConfig?.memoryExtractionDisabled!==true||
   !defaultModel||!['provider','modelId','thinkingLevel','fastMode'].every(key=>session.model?.[key]===defaultModel[key]))throw Error('AI_UNAVAILABLE');
  return {model:session.model,read:async()=>({
   session:await rpc('sessions.get',identity),messages:await rpc('sessions.messages',identity),
  })};
 }catch{throw Error('AI_UNAVAILABLE');}
}
