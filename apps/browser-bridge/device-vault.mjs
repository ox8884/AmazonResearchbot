import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function deviceVault(action, input) {
 if(process.platform!=='win32')throw new Error('WINDOWS_VAULT_REQUIRED');
 if(!['create','read','remove'].includes(action))throw new Error('INVALID_VAULT_ACTION');
 if(!input||typeof input!=='object'||typeof input.origin!=='string'||typeof input.deviceId!=='string')throw new Error('INVALID_VAULT_SLOT');
 let origin;
 try{origin=new URL(input.origin);}catch{throw new Error('INVALID_VAULT_ORIGIN');}
 const local=origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
 if((origin.protocol!=='https:'&&!local)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('INVALID_VAULT_ORIGIN');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.deviceId))throw new Error('INVALID_DEVICE_ID');
 if(action!=='read'&&(typeof input.credential!=='string'||!/^fbd_[a-f0-9]{64}$/.test(input.credential)))throw new Error('INVALID_DEVICE_CREDENTIAL');
 const target='ForgeKitchenOps/bridge/'+createHash('sha256').update(origin.origin).digest('hex')+'/'+input.deviceId;
 const executable=path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const helper=fileURLToPath(new URL('./windows-vault.ps1',import.meta.url));
 const payload={action,target,...(action==='read'?{}:{credential:input.credential})};
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['-NoProfile','-NonInteractive','-File',helper],{windowsHide:true,stdio:['pipe','pipe','ignore'],shell:false});
  let stdout='',failed=false;
  const fail=()=>{if(!failed){failed=true;child.kill();reject(new Error('WINDOWS_VAULT_OPERATION_FAILED'));}};
  const timer=setTimeout(fail,20000);
  child.on('error',fail);
  child.stdin.on('error',fail);
  child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');if(stdout.length>8192)fail();});
  child.on('close',code=>{
   clearTimeout(timer);if(failed)return;
   try{
    if(code!==0)throw new Error('VAULT_FAILED');
    const result=JSON.parse(stdout.replace(/^\uFEFF/,''));
    if(action==='read'){
     if(result.credential!==null&&(typeof result.credential!=='string'||!/^fbd_[a-f0-9]{64}$/.test(result.credential)))throw new Error('VAULT_FORMAT');
     resolve(result.credential);
    }else{
     if(result.ok!==true)throw new Error('VAULT_FORMAT');
     resolve(undefined);
    }
   }catch{reject(new Error('WINDOWS_VAULT_OPERATION_FAILED'));}
  });
  child.stdin.end(JSON.stringify(payload));
 });
}
