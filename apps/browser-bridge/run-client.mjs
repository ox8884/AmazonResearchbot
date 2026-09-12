import {createHash,createPublicKey} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {createBridgeClient} from './enrollment.mjs';
import {createAsideAdapter} from './aside-adapter.mjs';
import {deviceVault} from './device-vault.mjs';
import {openBrowserTaskLedger} from './task-ledger.mjs';
import {createRecoveryCycle} from './recovery-cycle.mjs';

let adapter,ledger,stopping=false,wake;
process.once('SIGINT',()=>{stopping=true;wake?.();});
process.once('SIGTERM',()=>{stopping=true;wake?.();});
try{
 const {values}=parseArgs({options:{config:{type:'string'},once:{type:'boolean',default:false}}});
 if(!values.config)throw new Error('BRIDGE_CONFIG_REQUIRED');
 const configuration=JSON.parse(await readFile(values.config,'utf8'));
 if(!configuration||Object.keys(configuration).some(key=>!['origin','deviceId','publicKey','directory','cliPath','accountId'].includes(key)))throw new Error('INVALID_BRIDGE_CONFIG');
 const client=createBridgeClient({origin:configuration.origin});
 const readCredential=()=>deviceVault('read',{origin:configuration.origin,deviceId:configuration.deviceId});
 if(!await readCredential())throw new Error('DEVICE_CREDENTIAL_MISSING');
 ledger=openBrowserTaskLedger(configuration);
 adapter=createAsideAdapter(configuration);
 const keyFingerprint=createHash('sha256').update(createPublicKey(configuration.publicKey).export({format:'der',type:'spki'})).digest('hex');
 const canClaim=async()=>{
  const report=await adapter.probe();
  await client.reportCapabilities({deviceId:configuration.deviceId,connected:report.connected,supportedTasks:report.supportedTasks,keyFingerprint});
  return report.connected&&report.supportedTasks.length>0;
 };
 const cycle=createRecoveryCycle({client,adapter,ledger,deviceId:configuration.deviceId,readCredential,shouldStop:()=>stopping,canClaim});
 let lastStatus;
 do{
  let delay=5000;
  try{
   const result=await cycle();
   for(const item of result.reconciled??[])if(['conflict','cancelled'].includes(item.kind))console.log(JSON.stringify({service:'browser-bridge',kind:item.kind,taskId:item.taskId}));
   const status=JSON.stringify({service:'browser-bridge',kind:result.kind,taskId:result.taskId??null,recovered:result.reconciled?.filter(item=>item.kind==='completed').length??0});
   if(status!==lastStatus){console.log(status);lastStatus=status;}
  }catch(error){
   const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'BRIDGE_CYCLE_FAILED';
   const status=JSON.stringify({service:'browser-bridge',kind:'attention',code});
   if(status!==lastStatus){console.error(status);lastStatus=status;}
   if(values.once||[401,403].includes(error.status)||code==='DEVICE_CREDENTIAL_MISSING'){process.exitCode=1;break;}
   delay=30000;
  }
  if(values.once||stopping)break;
  await new Promise(resolve=>{
   const timer=setTimeout(()=>{wake=undefined;resolve();},delay);
   wake=()=>{clearTimeout(timer);wake=undefined;resolve();};
  });
 }while(!stopping);
}catch{
 console.error('Browser bridge could not start. Check trusted configuration and device registration.');
 process.exitCode=1;
}finally{
 adapter?.close();ledger?.close();
}
