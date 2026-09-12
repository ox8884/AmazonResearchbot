import {
  readRuntimeAuthority,
  runtimeEnvironment,
  assertDatabaseAuthority,
} from "@forge-ops/security";
import { createPool } from "@forge-ops/db";
import { resolveTransport } from "@forge-ops/integrations/jungle-scout/transport";
import { PgBoss } from "pg-boss";
import { runDailyPlanner } from "./planner.ts";
const authority = await readRuntimeAuthority("scheduler", process.env);
const source = await runtimeEnvironment(authority, process.env);
const pool = createPool(authority.databaseUrl);
const databaseUrl = authority.databaseUrl;
const boss = new PgBoss({
  connectionString: databaseUrl,
  migrate: false,
  supervise: false,
  schedule: false,
});
try {
  await assertDatabaseAuthority(pool, authority);
  await boss.start();
  if (authority.appEnv === "development")
    await boss.createQueue("candidate.advance");
  console.log(
    JSON.stringify(
      await runDailyPlanner(pool, boss, {
        apiAvailable: resolveTransport(source).kind === "ready",
      }),
    ),
  );
} finally {
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
}
