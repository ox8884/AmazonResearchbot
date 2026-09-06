import { createPool } from "@forge-ops/db";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv(process.env);
const pool = createPool(env.databaseUrl);
const { app } = await buildApp(env, pool);
await app.listen({ port: env.apiPort, host: "127.0.0.1" });
app.log.info(`api http://127.0.0.1:${env.apiPort}`);
