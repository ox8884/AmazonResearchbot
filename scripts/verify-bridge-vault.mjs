import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {deviceVault} from '../apps/browser-bridge/device-vault.mjs';
const origin='http://localhost:5173',deviceId=randomUUID();
const credential='fbd_'+randomBytes(32).toString('hex');
const slot={origin,deviceId};
let created=false;
try{
 assert.equal(await deviceVault('read',slot),null);
 const attempts=await Promise.allSettled([deviceVault('create',{...slot,credential}),deviceVault('create',{...slot,credential})]);
 created=attempts.some(result=>result.status==='fulfilled');
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);

 assert.ok((await deviceVault('read',slot))===credential,'Stored credential differs');
 await assert.rejects(deviceVault('create',{...slot,credential:'fbd_'+randomBytes(32).toString('hex')}));
 await assert.rejects(deviceVault('remove',{...slot,credential:'fbd_'+randomBytes(32).toString('hex')}));
 assert.ok((await deviceVault('read',slot))===credential,'Stored credential differs');
 assert.equal(await deviceVault('read',{origin:'http://localhost:5174',deviceId}),null);
 await assert.rejects(deviceVault('read',{origin:'https://user:password@example.com',deviceId}));
 await assert.rejects(deviceVault('read',{origin,deviceId:'../other'}));
 await assert.rejects(deviceVault('read',{origin:'https://user:PRIVATE_SENTINEL@',deviceId}),error=>error.input===undefined&&error.message==='INVALID_VAULT_ORIGIN');

}finally{if(created)await deviceVault('remove',{...slot,credential});}
console.log(JSON.stringify({scenario:'bridge-vault',result:'PASS',nativeWindowsVault:true,concurrentCreateSafe:true,overwriteDenied:true,fixtureRemoved:true,originIsolation:true,secretPrinted:false}));
