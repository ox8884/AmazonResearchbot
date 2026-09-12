import {spawn} from 'node:child_process';
import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';

export async function startOptionalBrowserClient({root,source,onAttention=()=>console.error('ASIDE 연결 프로그램을 확인해 주세요. 메인 앱은 계속 실행됩니다.'),stdio='inherit'}){
 if(source.APP_ENV&&source.APP_ENV!=='development')throw new Error('LOCAL_BROWSER_DEVELOPMENT_ONLY');
 const configFile=path.resolve(root,source.BROWSER_BRIDGE_CONFIG??'data/browser-bridge/client.json');
 try{
  const expected=source.WEB_ORIGIN??'http://localhost:5173',origin=new URL(expected);
  if(!['http:','https:'].includes(origin.protocol)||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||origin.origin!==expected)throw new Error('nonlocal origin');
  const file=await lstat(configFile);
  if(!file.isFile()||file.size<1||file.size>16384)throw new Error('invalid config file');
  const config=JSON.parse(await readFile(configFile,'utf8'));
  if(config?.origin!==(source.WEB_ORIGIN??'http://localhost:5173'))throw new Error('origin mismatch');
 }catch(error){
  if(error.code!=='ENOENT')onAttention('BROWSER_CLIENT_CONFIGURATION_REJECTED');
  return null;
 }
 const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','HOMEDRIVE','HOMEPATH','TEMP','TMP','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','USERNAME','USERDOMAIN','LANG']);
 const env=Object.fromEntries(Object.entries(source).filter(([key])=>allowed.has(key.toUpperCase())));
 const child=spawn(process.execPath,[path.join(root,'apps/browser-bridge/run-client.mjs'),'--config',configFile],{cwd:root,env,stdio,shell:false,windowsHide:true,detached:process.platform==='win32'});
 const closed=new Promise(resolve=>{
  let settled=false;
  const finish=(code,signal)=>{if(settled)return;settled=true;if(code!==0&&!['SIGTERM','SIGINT'].includes(signal))onAttention('BROWSER_CLIENT_EXITED');resolve({code,signal});};
  child.once('error',()=>finish(null,null));
  child.once('close',finish);
 });
 return {child,closed};
}
