import {parseEnv} from "node:util";
import {validateDatabaseLocation} from "../packages/security/src/runtime-authority.ts";
import {assertDevelopmentDatabase} from "./support/development-database.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, migrate, seedInitialSettings } from "@forge-ops/db";
import { PgBoss } from "pg-boss";

if(process.env.APP_ENV && process.env.APP_ENV!=="development")throw new Error("LOCAL_DEVELOPMENT_ONLY");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const values=parseEnv(await readFile(path.join(root,".env"),"utf8"));
  if(values.APP_ENV && values.APP_ENV!=="development")throw new Error("LOCAL_DEVELOPMENT_ONLY");
  for(const [name,value] of Object.entries(values))if(process.env[name]==null)process.env[name]=value;
}catch(error){
  if(!(error instanceof Error)||!("code" in error)||error.code!=="ENOENT")throw new Error("LOCAL_DEVELOPMENT_ENV_REQUIRED");
}
const url=validateDatabaseLocation("development","worker",process.env.DATABASE_URL??"");
const target=new URL(url);
if(target.pathname!=="/forge_ops"||target.port!=="5433")throw new Error("LOCAL_DEVELOPMENT_DATABASE_REQUIRED");
const pool=createPool(url);
let boss:PgBoss|undefined;
try {
  await assertDevelopmentDatabase(pool);
  const applied=await migrate(pool);
  await seedInitialSettings(pool);
  boss=new PgBoss({connectionString:url,migrate:true,supervise:false,schedule:false});
  await boss.start();await boss.createQueue("candidate.advance");
  console.log(`migrations: ${applied.join(", ") || "none"}`);
}finally{
  if(boss)await boss.stop({graceful:false,timeout:2000});
  await pool.end();
}
