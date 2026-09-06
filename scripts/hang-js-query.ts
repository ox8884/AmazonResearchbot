import { createPool } from "@forge-ops/db";
import { executeJsQuery } from "@forge-ops/integrations/jungle-scout/execute";
import { createSimulatorTransport } from "@forge-ops/integrations/jungle-scout/transport";

const url = process.env.DATABASE_URL;
const origin = process.env.JS_SIMULATOR_ORIGIN;
if (!url || !origin) throw new Error("hang-js-query missing env");
const pool = createPool(url);
const result = await executeJsQuery(pool, createSimulatorTransport(origin, "development"), {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { hang: true },
  accountScope: "budget-kill",
  wireLimit: 3,
});
console.log(JSON.stringify({ kind: result.kind, fingerprint: result.fingerprint }));
await pool.end();
