import {
  readRuntimeAuthority,
  runtimeEnvironment,
  assertDatabaseAuthority,
} from "@forge-ops/security";
import { prepareRecoveryCodeStorage } from "./recovery-code-storage.ts";
import { createPool } from "@forge-ops/db";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const authority = await readRuntimeAuthority("api", process.env);
const env = loadEnv(await runtimeEnvironment(authority, process.env));
const pool = createPool(env.databaseUrl);
try {
  await assertDatabaseAuthority(pool, authority);
} catch (error) {
  await pool.end();
  throw error;
}
const authMigrations = await pool.query<{ count: number }>(
  "SELECT count(*)::int AS count FROM schema_migrations WHERE id=ANY($1::text[])",
  [
    [
      "0017_trusted_devices.sql",
      "0018_factor_enrollment_sessions.sql",
      "0019_pending_factor_setup.sql",
    ],
  ],
);
if (authMigrations.rows[0]?.count !== 3)
  throw new Error("Authentication migrations are required before API startup");
await pool.query(
  "UPDATE verification SET identifier='trust-device-sha256:' || encode(sha256(convert_to(identifier,'UTF8')),'hex') WHERE identifier LIKE 'trust-device-%' AND identifier NOT LIKE 'trust-device-sha256:%'",
);
await prepareRecoveryCodeStorage(pool, env.authSecret);
const { app } = await buildApp(env, pool);
await app.listen({ port: env.apiPort, host: "127.0.0.1" });
app.log.info(`api http://127.0.0.1:${env.apiPort}`);

process.once("SIGTERM", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
