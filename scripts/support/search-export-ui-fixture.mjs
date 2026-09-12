import assert from 'node:assert/strict';
import {browserSigningFixture} from './browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../../apps/worker/src/browser-signing-key.ts';
import {dispatchBrowserWork} from '../../apps/worker/src/browser-dispatch.ts';
import {createBridgeClient} from '../../apps/browser-bridge/enrollment.mjs';
import {createAsideAdapter} from '../../apps/browser-bridge/aside-adapter.mjs';
import {openBrowserTaskLedger} from '../../apps/browser-bridge/task-ledger.mjs';
import {createRecoveryCycle} from '../../apps/browser-bridge/recovery-cycle.mjs';
import {deviceVault} from '../../apps/browser-bridge/device-vault.mjs';

export async function searchExportUiFixture(test,origin,directory,mode='search-export'){
 const keys=browserSigningFixture(),identity=await publishBrowserSigningIdentity(test.pool,keys.privateKey);
 const signing={origin,privateKey:keys.privateKey,fingerprint:identity.fingerprint},client=createBridgeClient({origin});
 const pairing=await test.call('/api/bridge/pairings',{});assert.equal(pairing.status,201);
 const device=await client.enrollBrowserDevice({pairingCode:pairing.body.pairingCode,name:'합성 ASIDE 자동 수집 검증'});
 const configuration={origin,directory,deviceId:device.deviceId,publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),cliPath:process.env.FORGE_ASIDE_CLI_PATH,accountId:process.env.FORGE_ASIDE_ACCOUNT};
 const adapter=createAsideAdapter(configuration),ledger=openBrowserTaskLedger(configuration);
 const readCredential=()=>deviceVault('read',{origin,deviceId:device.deviceId});
 const canClaim=async()=>{const report=await adapter.probe();await client.reportCapabilities({deviceId:device.deviceId,connected:report.connected,supportedTasks:report.supportedTasks,keyFingerprint:identity.fingerprint});return report.connected;};
 await canClaim();
 const cycle=createRecoveryCycle({client,adapter,ledger,deviceId:device.deviceId,readCredential,canClaim});
 let subject;
 if(mode==='market'){
  const candidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us','silicone spatula set','silicone spatula set','api_validation') RETURNING id")).rows[0];
  subject={entryPath:'/candidates/'+candidate.id,candidateId:candidate.id};
 }else{
  const search=await test.call('/api/saved-searches',{name:'합성 UI 검증 · 실제 주방 후보 검색',filters:{priceMinUsd:'20',priceMaxUsd:'40',monthlySearchMin:500,competitionMax:'Low',seasonalityMax:'Low'}});assert.equal(search.status,201);
  subject={entryPath:'/research',searchId:search.body.id};
 }
 let running=false,pending=Promise.resolve();
 const timer=setInterval(()=>{
  if(running)return;running=true;
  pending=(async()=>{await dispatchBrowserWork(test.pool,signing);await cycle();})()
   .catch(()=>console.error(JSON.stringify({fixture:'search-export-ui',state:'attention'}))).finally(()=>{running=false;});
 },2000);
 return {...subject,close:async()=>{clearInterval(timer);await pending;adapter.close();ledger.close();}};
}
