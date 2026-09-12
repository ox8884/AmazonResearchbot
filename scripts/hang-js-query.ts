import { createPool } from "@forge-ops/db";
import { executeJsQuery } from "@forge-ops/integrations/jungle-scout/execute";
import { createSimulatorTransport } from "@forge-ops/integrations/jungle-scout/transport";

const url = process.env.DATABASE_URL;
const origin = process.env.JS_SIMULATOR_ORIGIN;
if (!url || !origin) throw new Error("hang-js-query missing env");
const database = new URL(url);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || !/^\/forge_ops_acceptance_[a-f0-9]{12}$/.test(database.pathname))
  throw new Error("Dedicated local acceptance database required");
const dispatchAt = process.env.TEST_DISPATCH_AT;
const scope = process.env.TEST_ACCOUNT_SCOPE;
if (!dispatchAt || Number.isNaN(new Date(dispatchAt).getTime()) || !scope?.startsWith("budget-kill:"))
  throw new Error("Acceptance context required");
const pool = createPool(url);
const result = await executeJsQuery(pool, createSimulatorTransport(origin, "development"), {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { hang: true },
  accountScope: scope,
  wireLimit: 3,
  testDispatchAt: new Date(dispatchAt),
});
console.log(JSON.stringify({ kind: result.kind, fingerprint: result.fingerprint }));
await pool.end();
