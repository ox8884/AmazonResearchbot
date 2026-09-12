import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {lstat,mkdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createBridgeClient} from './enrollment.mjs';

let deviceId;
try{
 const {values}=parseArgs({options:{config:{type:'string'},origin:{type:'string'},name:{type:'string'},directory:{type:'string'},'aside-cli':{type:'string'},account:{type:'string'}}});
 if(!values.config)throw new Error('BRIDGE_CONFIG_PATH_REQUIRED');
 const configFile=path.resolve(values.config);
 try{await lstat(configFile);throw new Error('BRIDGE_CONFIG_EXISTS');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const input={origin:values.origin,name:values.name,directory:values.directory,cliPath:values['aside-cli'],accountId:values.account};
 if(process.platform!=='win32'||typeof input.directory!=='string'||!path.isAbsolute(input.directory)||typeof input.cliPath!=='string'||!path.isAbsolute(input.cliPath)||path.basename(input.cliPath).toLowerCase()!=='aside.exe'||!(await stat(input.cliPath)).isFile()||typeof input.accountId!=='string'||!/^u\d+$/.test(input.accountId))throw new Error('INVALID_BRIDGE_SETUP');
 const client=createBridgeClient({origin:input.origin});
 await mkdir(path.dirname(configFile),{recursive:true,mode:0o700});
 if(process.stdin.isTTY)console.error('ASIDE 연결 코드를 붙여넣고 Enter를 누르세요. 입력은 표시하지 않습니다.');
 const silentOutput=new Writable({write(_chunk,_encoding,done){done();}});
 const lines=createInterface({input:process.stdin,output:silentOutput,terminal:Boolean(process.stdin.isTTY)});
 let pairingCode;
 try{for await(const line of lines){pairingCode=line.trim();break;}}finally{lines.close();}
 const enrolled=await client.enrollBrowserDevice({pairingCode,name:input.name});
 deviceId=enrolled.deviceId;
 if(!enrolled.signingKey)throw new Error('SIGNING_KEY_NOT_READY_REVOKE_REGISTRATION');
 const config={origin:new URL(input.origin).origin,deviceId,publicKey:enrolled.signingKey.publicKey,directory:input.directory,cliPath:input.cliPath,accountId:input.accountId};
 await writeFile(configFile,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({configured:true,deviceId,configFile,browserAvailable:false}));
}catch(error){
 const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'BRIDGE_SETUP_FAILED';
 console.error(JSON.stringify({configured:false,code,...(deviceId||error.deviceId?{deviceId:deviceId??error.deviceId,registrationNeedsReview:true}:{})}));
 process.exitCode=1;
}
