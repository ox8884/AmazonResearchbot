import { createPool } from "@forge-ops/db";
import { executeJsQuery } from "@forge-ops/integrations/jungle-scout/execute";
import { createSimulatorTransport } from "@forge-ops/integrations/jungle-scout/transport";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing`);
  return value;
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("TEST_QUERY must be an object");
  }
  return Object.fromEntries(Object.entries(value));
}

const databaseUrl = required("DATABASE_URL");
const origin = required("JS_SIMULATOR_ORIGIN");
const accountScope = required("TEST_ACCOUNT_SCOPE");
const dispatchAt = new Date(required("TEST_DISPATCH_AT"));
if (Number.isNaN(dispatchAt.getTime())) throw new Error("TEST_DISPATCH_AT invalid");
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || !/^\/forge_ops_acceptance_[a-f0-9]{12}$/.test(target.pathname)) {
  throw new Error("Dedicated local acceptance database required");
}
const pool = createPool(databaseUrl);
try {
  const result = await executeJsQuery(pool, createSimulatorTransport(origin, "development"), {
    endpoint: "product_database_query",
    marketplace: "us",
    query: parseObject(required("TEST_QUERY")),
    accountScope,
    wireLimit: 3,
    testDispatchAt: dispatchAt,
  });
  console.log(JSON.stringify({ kind: result.kind, fingerprint: result.fingerprint }));
} finally {
  await pool.end();
}
