import { createPrivateKey, createPublicKey, createHash, type KeyObject } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import type { Pool } from "@forge-ops/db";

export async function loadBrowserSigningKey(source:NodeJS.ProcessEnv,appEnv:"development"|"production"):Promise<KeyObject|null> {
 if(source.BROWSER_TASKS_ENABLED!=="true")return null;
 try{
  let pem:string;
  if(appEnv==="production"){
   if(!source.BROWSER_SIGNING_KEY)throw new Error("missing service credential");
   pem=source.BROWSER_SIGNING_KEY;
  }else{
   if(!source.BROWSER_SIGNING_KEY_FILE)throw new Error("missing key file");
   const info=await lstat(source.BROWSER_SIGNING_KEY_FILE);
   if(!info.isFile()||info.size>16384||info.size===0||(process.platform!=="win32"&&(info.mode&0o077)!==0))throw new Error("key file policy");
   pem=await readFile(source.BROWSER_SIGNING_KEY_FILE,"utf8");
  }
  const key=createPrivateKey(pem);
  if(key.type!=="private"||key.asymmetricKeyType!=="ed25519")throw new Error("wrong key type");
  return key;
 }catch{throw new Error("BROWSER_SIGNING_KEY_REQUIRED");}
}
export async function publishBrowserSigningIdentity(pool:Pool,key:KeyObject) {
 const publicKey=createPublicKey(key);
 const pem=publicKey.export({format:"pem",type:"spki"}).toString();
 const fingerprint=createHash("sha256").update(publicKey.export({format:"der",type:"spki"})).digest("hex");
 if(key.type!=="private"||key.asymmetricKeyType!=="ed25519")throw new Error("INVALID_BROWSER_SIGNING_KEY");
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.browser.signing-identity'))");
  const old=(await db.query<{fingerprint:string}>("SELECT fingerprint FROM browser_signing_identity WHERE singleton=1")).rows[0];
  if(old&&old.fingerprint!==fingerprint)throw new Error("BROWSER_SIGNING_KEY_MISMATCH");
  if(!old)await db.query("INSERT INTO browser_signing_identity(singleton,public_key,fingerprint) VALUES(1,$1,$2)",[pem,fingerprint]);
  await db.query("COMMIT");return {publicKey:pem,fingerprint};
 }catch(error){await db.query("ROLLBACK");throw error;}
 finally{db.release();}
}
