import {openBrowserTaskLedger} from '../../apps/browser-bridge/task-ledger.mjs';
let ledger,configuration;
process.on('message',message=>{
 if(message.kind==='setup'){
  configuration=message;
  ledger=openBrowserTaskLedger(message.config);
  process.send({kind:'ready'});
 }else if(message.kind==='claim'&&ledger){
  const result=ledger.claim(configuration.envelope);
  if(configuration.exitBeforeCompletion)process.exit(17);
  process.send({kind:'result',result},()=>{
   ledger.close();ledger=null;process.disconnect();
  });
 }
});
process.on('disconnect',()=>ledger?.close());
