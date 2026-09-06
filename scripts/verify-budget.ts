import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, recoverDispatchingAttempts } from "@forge-ops/db";
import { executeJsQuery } from "@forge-ops/integrations/jungle-scout/execute";
import { createSimulatorTransport } from "@forge-ops/integrations/jungle-scout/transport";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = await readFile(path.join(root, ".env"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (process.env[k] == null) process.env[k] = v;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const hits: string[] = [];
const held: ServerResponse[] = [];
let sequence = ["429", "500", "200"];

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    hits.push(`${req.method} ${req.url} ${raw.slice(0, 80)}`);
    if (raw.includes('"hang":true')) {
      held.push(res);
      return;
    }
    if (raw.includes('"seq":true') || raw.includes('"seq2":true')) {
      const code = Number(sequence.shift() ?? "200");
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [] }));
  });
});
const listening = Promise.withResolvers<void>();
server.listen(0, "127.0.0.1", listening.resolve);
await listening.promise;
const addr = server.address();
if (!addr || typeof addr === "string") throw new Error("no port");
const origin = `http://127.0.0.1:${addr.port}`;
const transport = createSimulatorTransport(origin, "development");
const pool = createPool(process.env.DATABASE_URL ?? "");
const day = new Date().toISOString().slice(0, 10);

await pool.query(`DELETE FROM api_attempts`);
await pool.query(`DELETE FROM api_cache`);
await pool.query(`DELETE FROM api_operations`);
await pool.query(`DELETE FROM budget_days WHERE day_utc = $1::date`, [day]);
await pool.query(`INSERT INTO budget_days (day_utc, wire_limit) VALUES ($1::date, 3)`, [day]);

hits.length = 0;
const different = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    executeJsQuery(pool, transport, {
      endpoint: "product_database_query",
      marketplace: "us",
      query: { i },
      accountScope: "budget",
      wireLimit: 3,
      budgetDay: day,
    }),
  ),
);
assert(hits.length <= 3, `cap3 expected <=3 wires, got ${hits.length}`);
assert(
  different.filter((r) => r.kind === "succeeded" || r.kind === "cache").length <= 3,
  "cap3 successes",
);
assert(different.filter((r) => r.kind === "budget_blocked").length >= 17, "cap3 should block the rest");

await pool.query(`DELETE FROM api_attempts`);
await pool.query(`DELETE FROM api_cache`);
await pool.query(`DELETE FROM api_operations`);
await pool.query(`UPDATE budget_days SET reserved = 0, consumed = 0, wire_limit = 0 WHERE day_utc = $1::date`, [day]);
hits.length = 0;
const cap0 = await Promise.all(
  Array.from({ length: 5 }, (_, i) =>
    executeJsQuery(pool, transport, {
      endpoint: "product_database_query",
      marketplace: "us",
      query: { cap0: i },
      accountScope: "budget",
      wireLimit: 0,
      budgetDay: day,
    }),
  ),
);
assert(hits.length === 0, `cap0 wires ${hits.length}`);
assert(cap0.every((r) => r.kind === "budget_blocked"), "cap0 all blocked");

await pool.query(`DELETE FROM api_attempts`);
await pool.query(`DELETE FROM api_cache`);
await pool.query(`DELETE FROM api_operations`);
await pool.query(`UPDATE budget_days SET reserved = 0, consumed = 0, wire_limit = 3 WHERE day_utc = $1::date`, [day]);
hits.length = 0;
const same = await Promise.all(
  Array.from({ length: 20 }, () =>
    executeJsQuery(pool, transport, {
      endpoint: "product_database_query",
      marketplace: "us",
      query: { same: true },
      accountScope: "budget",
      wireLimit: 3,
      budgetDay: day,
    }),
  ),
);
assert(hits.length === 1, `same query concurrent wires ${hits.length}`);
const cacheAgain = await executeJsQuery(pool, transport, {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { same: true },
  accountScope: "budget",
  wireLimit: 3,
  budgetDay: day,
});
assert(cacheAgain.kind === "cache", `cache rerun ${cacheAgain.kind}`);
assert(hits.length === 1, "cache rerun must not wire");
assert(same.some((r) => r.kind === "succeeded" || r.kind === "cache"), "one winner");

await pool.query(`DELETE FROM api_attempts`);
await pool.query(`DELETE FROM api_cache`);
await pool.query(`DELETE FROM api_operations`);
await pool.query(`UPDATE budget_days SET reserved = 0, consumed = 0, wire_limit = 3 WHERE day_utc = $1::date`, [day]);
hits.length = 0;
sequence = ["429", "500", "200"];
const seqTransport = createSimulatorTransport(origin, "development");
const seqResult = await executeJsQuery(pool, seqTransport, {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { seq: true },
  pagination: { seq: true },
  accountScope: "budget",
  wireLimit: 3,
  budgetDay: day,
});
void seqResult;
assert(hits.length === 3, `429-500-200 wires ${hits.length}`);

await pool.query(`DELETE FROM api_attempts`);
await pool.query(`DELETE FROM api_cache`);
await pool.query(`DELETE FROM api_operations`);
await pool.query(`UPDATE budget_days SET reserved = 0, consumed = 0, wire_limit = 2 WHERE day_utc = $1::date`, [day]);
hits.length = 0;
sequence = ["429", "500", "200"];
await executeJsQuery(pool, createSimulatorTransport(origin, "development"), {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { seq2: true },
  accountScope: "budget",
  wireLimit: 2,
  budgetDay: day,
});
assert(hits.length === 2, `budget2 third wire must be 0, got ${hits.length}`);

hits.length = 0;
const dead = createPool(process.env.DATABASE_URL ?? "");
await dead.end();
const dbFail = await executeJsQuery(dead, transport, {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { dbFail: true },
  accountScope: "budget",
  wireLimit: 3,
  budgetDay: day,
});
assert(dbFail.kind === "db_unavailable", `db fail ${dbFail.kind}`);
assert(hits.length === 0, "db fail must not wire");

await pool.query(`DELETE FROM api_attempts`);
await pool.query(`DELETE FROM api_cache`);
await pool.query(`DELETE FROM api_operations`);
await pool.query(`UPDATE budget_days SET reserved = 0, consumed = 0, wire_limit = 3 WHERE day_utc = $1::date`, [day]);
hits.length = 0;
const child = spawn(
  process.execPath,
  [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/hang-js-query.ts"],
  {
    cwd: root,
    env: { ...process.env, JS_SIMULATOR_ORIGIN: origin, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "ignore",
  },
);
for (let i = 0; i < 50 && hits.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
assert(hits.length === 1, `hang never reached simulator ${hits.length}`);
child.kill("SIGKILL");
await new Promise((r) => setTimeout(r, 300));
await recoverDispatchingAttempts(pool);
const afterKill = await executeJsQuery(pool, transport, {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { hang: true },
  accountScope: "budget-kill",
  wireLimit: 3,
  budgetDay: day,
});
assert(afterKill.kind === "already_handled" || afterKill.kind === "outcome_unknown", `kill retry ${afterKill.kind}`);
assert(hits.length === 1, `kill must not rewire, got ${hits.length}`);
for (const res of held) {
  try {
    res.writeHead(200);
    res.end("{}");
  } catch {
    /* ignore */
  }
}

const sortA = await executeJsQuery(pool, transport, {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { q: "k" },
  sort: { field: "revenue" },
  pagination: { cursor: "a" },
  accountScope: "budget",
  wireLimit: 3,
  budgetDay: day,
});
const sortB = await executeJsQuery(pool, transport, {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { q: "k" },
  sort: { field: "price" },
  pagination: { cursor: "b" },
  accountScope: "budget",
  wireLimit: 3,
  budgetDay: day,
});
assert(sortA.fingerprint !== sortB.fingerprint, "sort/cursor must split cache keys");

const day2 = "1999-01-02";
await pool.query(`INSERT INTO budget_days (day_utc, wire_limit) VALUES ($1::date, 1) ON CONFLICT DO NOTHING`, [day2]);
const midnight = await executeJsQuery(pool, transport, {
  endpoint: "product_database_query",
  marketplace: "us",
  query: { midnight: true },
  accountScope: "budget",
  wireLimit: 1,
  budgetDay: day2,
});
assert(midnight.kind === "succeeded" || midnight.kind === "cache" || midnight.kind === "budget_blocked", "utc day used");

await pool.end();
server.close();
console.log(
  JSON.stringify(
    {
      scenario: "budget",
      cap3Wires: true,
      cap0Wires: 0,
      sameQueryWires: 1,
      retryBudget: true,
      dbFailWires: 0,
      killNoRewire: true,
      sortCursorSplit: true,
    },
    null,
    2,
  ),
);
