import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {statSync} from 'node:fs';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

export function launchAside(configuration,args,stdio) {
 const bashPath=path.join(process.env.ProgramFiles??'C:\\Program Files','Git','bin','bash.exe');
 if(!statSync(bashPath).isFile())throw new Error('ASIDE_BASH_UNAVAILABLE');
 const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','HOMEDRIVE','HOMEPATH','TEMP','TMP','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','USERNAME','USERDOMAIN','LANG']);
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toUpperCase())));
 const child=spawn(bashPath,['-lc','exec "$@"','forge-aside',configuration.cliPath.split(String.fromCharCode(92)).join('/'),...args],{windowsHide:true,shell:false,env,stdio});
 // Git Bash does not replace itself with aside.exe, so the default kill would orphan it; end the whole tree instead.
 const killWrapper=child.kill.bind(child);
 child.kill=()=>{
  if(child.exitCode!==null||child.signalCode!==null||!child.pid)return false;
  const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});
  killer.once('error',()=>killWrapper());
  killer.once('close',code=>{if(code!==0)killWrapper();});
  return true;
 };
 return child;
}

export function createAsideRunner(configuration) {
 return async function invoke(makeScript,{onReady,finishScript,timeoutMs=130000}={}) {
  const marker='FORGE_ASIDE_'+randomUUID()+':',script=makeScript(marker),interactive=typeof onReady==='function',deadline=Date.now()+timeoutMs;
  return new Promise((resolve,reject)=>{
   const args=['repl','--account',configuration.accountId,'--host','local'];
   const child=launchAside(configuration,args,['pipe','pipe','ignore']);
   const decoder=new StringDecoder('utf8');
   let output='',size=0,settled=false,ready=false,result;
   const stop=(error)=>{
    if(settled)return;settled=true;clearTimeout(timer);child.kill();
    if(error)reject(error);else resolve(result);
   };
   const fail=()=>stop(new Error('ASIDE_EXECUTION_UNCONFIRMED'));
   const timer=setTimeout(fail,timeoutMs);
   const write=source=>{
    if(!settled)child.stdin.write('await eval('+JSON.stringify('(async()=>{'+source+'})()')+')\n');
   };
   const line=value=>{
    const clean=value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
    const offset=clean.indexOf(marker);
    if(offset<0)return;
    const raw=clean.slice(offset+marker.length);
    if(!raw.startsWith('{'))return;
    let parsed;try{parsed=JSON.parse(raw);}catch{stop(new Error('ASIDE_RESPONSE_INVALID'));return;}
    if(parsed?.protocol!==1){stop(new Error('ASIDE_RESPONSE_INVALID'));return;}
    if(parsed.kind==='ready'){
     if(!interactive||ready||result){stop(new Error('ASIDE_RESPONSE_INVALID'));return;}
     ready=true;
     // Never authorize a click that cannot finish (identity check, click, receipt wait) before the session timeout.
     if(deadline-Date.now()<45000){write(finishScript({allowed:false,reason:'ALIBABA_DISPATCH_DEADLINE'}));return;}
     Promise.resolve().then(()=>onReady(parsed)).then(authorization=>{
      if(!settled)write(finishScript(authorization));
     },()=>{if(!settled)write(finishScript({allowed:false,reason:'ALIBABA_DISPATCH_UNCONFIRMED'}));});
    }else{
     if(result){stop(new Error('ASIDE_RESPONSE_INVALID'));return;}
     result=parsed;
     child.stdin.end('exit\n');
    }
   };
   child.on('error',fail);
   child.stdin?.on('error',fail);
   child.stdout.on('data',chunk=>{
    size+=chunk.length;if(size>4*1024*1024){fail();return;}
    output+=decoder.write(chunk);
    let end;
    while((end=output.indexOf('\n'))>=0){line(output.slice(0,end).replace(/\r$/,''));output=output.slice(end+1);}
   });
   child.on('close',code=>{
    if(settled)return;
    output+=decoder.end();if(output)line(output);
    if(code!==0||!result){fail();return;}
    stop();
   });
   write(script);
  });
 };
}
