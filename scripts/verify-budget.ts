import { retryNotBefore } from "../packages/integrations/src/jungle-scout/retry-parser.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import {
  authorizeAttempt,
  createPool,
  finalizeAttempt,
  markDispatching,
  recoverDispatchingAttempts,
} from "@forge-ops/db";
import {
  executeJsQuery,
  type JsQueryRequest,
} from "@forge-ops/integrations/jungle-scout/execute";
import {
  createSimulatorTransport,
  denyTransport,
} from "@forge-ops/integrations/jungle-scout/transport";
import { openAcceptance } from "./support/acceptance.mjs";

type PlannedResponse = {
  readonly status: number;
  readonly retryAfter?: string;
  readonly body?: unknown;
};

const test = await openAcceptance({ databaseKey: `budget-rate-retry-${process.pid}-${Date.now().toString(36)}` });
let wireHits = 0;
let plannedResponses: PlannedResponse[] = [];
let heldResponse: ServerResponse | undefined;
const receivedHang = Promise.withResolvers<void>();
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  wireHits += 1;
  if (Buffer.concat(chunks).toString("utf8").includes('"hang":true')) {
    heldResponse = response;
    receivedHang.resolve();
    return;
  }
  const plan = plannedResponses.shift() ?? { status: 200, body: { data: [] } };
  response.writeHead(plan.status, {
    "content-type": "application/json",
    ...(plan.retryAfter === undefined ? {} : { "retry-after": plan.retryAfter }),
  });
  response.end(JSON.stringify(plan.body ?? { data: [] }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Local fixture unavailable");
const origin = `http://127.0.0.1:${address.port}`;
const transport = createSimulatorTransport(origin, "development");
let hangingChild: ReturnType<typeof spawn> | undefined;

function at(iso: string): Date {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) throw new Error(`Invalid fixture time ${iso}`);
  return value;
}

function day(atTime: Date): string {
  return atTime.toISOString().slice(0, 10);
}

function request(
  testDispatchAt: Date,
  wireLimit: number,
  query: unknown,
  scope = "budget",
): JsQueryRequest {
  return {
    endpoint: "product_database_query",
    marketplace: "us",
    query,
    accountScope: `${scope}:${test.runId}`,
    wireLimit,
    testDispatchAt,
  };
}

async function approveCap(limit: number): Promise<void> {
  await test.pool.query(
    `INSERT INTO settings_versions(version,effective_at,approved_by,snapshot)
     SELECT version+1,now(),'budget-fixture',jsonb_set(snapshot,'{jsDailyWireCap}',to_jsonb($1::int))
     FROM settings_versions ORDER BY version DESC LIMIT 1`,
    [limit],
  );
}

async function runResumeChild(input: JsQueryRequest): Promise<string> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/support/resume-js-query.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: test.databaseUrl,
        JS_SIMULATOR_ORIGIN: origin,
        TEST_ACCOUNT_SCOPE: input.accountScope,
        TEST_DISPATCH_AT: input.testDispatchAt?.toISOString() ?? "",
        TEST_QUERY: JSON.stringify(input.query),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  const [code] = await once(child, "close");
  assert.equal(code, 0, "Fresh-process retry probe must finish");
  return output;
}

try {
  const initialAt = at("2099-01-01T00:00:00.000Z");
  await approveCap(1_000);

  // Given a disabled transport, when a request is evaluated, then it creates no attempt.
  const attemptsBeforeDenied = Number(
    (await test.pool.query("SELECT count(*)::int AS count FROM api_attempts")).rows[0]
      ?.count,
  );
  assert.equal(
    (await executeJsQuery(
      test.pool,
      denyTransport(),
      request(initialAt, 1_000, { disabled: true }),
    )).kind,
    "denied",
  );
  assert.equal(
    Number((await test.pool.query("SELECT count(*)::int AS count FROM api_attempts")).rows[0]?.count),
    attemptsBeforeDenied,
  );

  // Given 20 concurrent requests for one account, when the second window is full, then only 15 wire calls occur.
  const rateResults = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      executeJsQuery(test.pool, transport, request(initialAt, 1_000, { rateSecond: index }, "rate-second")),
    ),
  );
  assert.equal(wireHits, 15);
  assert.equal(rateResults.filter((result) => result.kind === "deferred").length, 5);
  assert.ok(
    rateResults
      .filter((result) => result.kind === "deferred")
      .every((result) => result.kind === "deferred" && result.reason === "rate_limit"),
  );
  assert.deepEqual(
    (
      await test.pool.query(
        `SELECT request_count FROM api_rate_windows
         WHERE account_scope=$1 AND window_kind='second' AND window_started_at=$2`,
        [`rate-second:${test.runId}`, initialAt],
      )
    ).rows[0],
    { request_count: 15 },
  );
  assert.equal(
    (
      await executeJsQuery(
        test.pool,
        transport,
        request(initialAt, 1_000, { otherAccount: true }, "rate-other-account"),
      )
    ).kind,
    "succeeded",
  );
  assert.equal(wireHits, 16, "A different account has an independent rate window");

  const boundaryStart = at("2099-01-01T00:01:00.900Z");
  const boundaryBefore = wireHits;
  const boundaryFirst = await Promise.all(
    Array.from({ length: 15 }, (_, index) =>
      executeJsQuery(test.pool, transport, request(boundaryStart, 1_000, { boundaryFirst: index }, "rate-boundary")),
    ),
  );
  assert.ok(boundaryFirst.every((result) => result.kind === "succeeded"));
  const boundarySecond = await Promise.all(
    Array.from({ length: 15 }, (_, index) =>
      executeJsQuery(
        test.pool,
        transport,
        request(at("2099-01-01T00:01:01.000Z"), 1_000, { boundarySecond: index }, "rate-boundary"),
      ),
    ),
  );
  assert.ok(
    boundarySecond.every(
      (result) => result.kind === "deferred" && result.reason === "rate_limit" && result.retryAt.toISOString() === "2099-01-01T00:01:01.900Z",
    ),
  );
  assert.equal(wireHits, boundaryBefore + 15, "Rolling one-second limit blocks a boundary burst");

  // Given 300 authorized requests distributed over one minute, when request 301 is dispatched, then it is deferred without a wire attempt.
  const minuteStart = at("2099-01-02T00:00:00.000Z");
  const minuteScope = `rate-minute:${test.runId}`;
  for (let index = 0; index < 300; index += 1) {
    const client = await test.pool.connect();
    const dispatchAt = new Date(minuteStart.getTime() + Math.floor(index / 15) * 1_000);
    try {
      await client.query("BEGIN");
      const decision = await authorizeAttempt(client, {
        fingerprint: createHash("sha256").update(`minute:${test.runId}:${index}`).digest("hex"),
        provider: "junglescout",
        endpoint: "product_database_query",
        accountScope: minuteScope,
        budgetDay: day(dispatchAt),
        wireLimit: 1_000,
        testNow: dispatchAt,
      });
      assert.equal(decision.kind, "authorized");
      if (decision.kind !== "authorized") throw new Error("Minute fixture was not authorized");
      await markDispatching(client, decision.attemptId);
      await finalizeAttempt(client, {
        attemptId: decision.attemptId,
        budgetDay: day(dispatchAt),
        fingerprint: createHash("sha256").update(`minute:${test.runId}:${index}`).digest("hex"),
        status: "http_failed",
        httpStatus: 400,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const minuteClient = await test.pool.connect();
  try {
    await minuteClient.query("BEGIN");
    const blocked = await authorizeAttempt(minuteClient, {
      fingerprint: createHash("sha256").update(`minute:${test.runId}:301`).digest("hex"),
      provider: "junglescout",
      endpoint: "product_database_query",
      accountScope: minuteScope,
      budgetDay: day(at("2099-01-02T00:00:20.000Z")),
      wireLimit: 1_000,
      testNow: at("2099-01-02T00:00:20.000Z"),
    });
    assert.equal(blocked.kind, "deferred");
    if (blocked.kind === "deferred") {
      assert.equal(blocked.reason, "rate_limit");
      assert.equal(blocked.retryAt.toISOString(), "2099-01-02T00:01:00.000Z");
    }
    await minuteClient.query("COMMIT");
  } catch (error) {
    await minuteClient.query("ROLLBACK");
    throw error;
  } finally {
    minuteClient.release();
  }
  assert.equal(wireHits, boundaryBefore + 15, "Rate ledger authorization never emits a wire request");

  // Given a 429 before UTC midnight, when the retry is due after midnight, then the current day cap is reauthorized.
  const firstDispatch = at("2099-12-31T23:59:58.000Z");
  const retryRequest = request(firstDispatch, 3, { restart: true }, "retry-restart");
  await approveCap(3);
  wireHits = 0;
  plannedResponses = [
    {
      status: 429,
      retryAfter: "1",
      body: { errors: [{ detail: "REQUEST_THROTTLED; retry again at 2100-01-01T00:00:15.000Z" }] },
    },
  ];
  const firstRetry = await executeJsQuery(test.pool, transport, {
    ...retryRequest,
    testResponseReceivedAt: at("2100-01-01T00:00:08.000Z"),
  });
  assert.equal(firstRetry.kind, "deferred");
  if (firstRetry.kind === "deferred") {
    assert.equal(firstRetry.reason, "retry");
    assert.equal(firstRetry.retryAt.toISOString(), "2100-01-01T00:00:15.000Z");
  }
  assert.equal(wireHits, 1);
  assert.deepEqual(
    (await test.pool.query("SELECT reserved,consumed,wire_limit FROM budget_days WHERE day_utc=$1", [day(firstDispatch)])).rows[0],
    { reserved: 0, consumed: 1, wire_limit: 3 },
  );
  const immediateRetry = await executeJsQuery(test.pool, transport, retryRequest);
  assert.equal(immediateRetry.kind, "deferred");
  assert.equal(wireHits, 1, "Retry-before-due must not hammer the provider");
  const resumedOutput = await runResumeChild({ ...retryRequest, testDispatchAt: at("2099-12-31T23:59:59.000Z") });
  assert.match(resumedOutput, /"kind":"deferred"/);
  assert.equal(wireHits, 1, "A fresh process must retain retry state and avoid a duplicate wire");
  assert.deepEqual(
    (
      await test.pool.query(
        `SELECT retry_count,next_attempt_at FROM api_retry_schedules
         WHERE operation_id=(SELECT id FROM api_operations WHERE fingerprint=$1)`,
        [firstRetry.fingerprint],
      )
    ).rows[0],
    { retry_count: 1, next_attempt_at: at("2100-01-01T00:00:15.000Z") },
  );
  await approveCap(1);
  plannedResponses = [
    {
      status: 500,
      retryAfter: "Thu, 01 Jan 2100 00:00:40 GMT",
      body: { error: "retry again at 2100-01-01T00:00:42.000Z" },
    },
  ];
  const tighterWindow=await executeJsQuery(test.pool,transport,{...retryRequest,testDispatchAt:at("2100-01-01T00:00:15.000Z")});
  assert.equal(tighterWindow.kind,"deferred");
  if(tighterWindow.kind==="deferred"){assert.equal(tighterWindow.reason,"rate_limit");assert.equal(tighterWindow.retryAt.toISOString(),"2100-01-01T00:00:58.000Z");}
  assert.equal(wireHits,1,"A lowered rate cap also counts the previous UTC day's recent wire");
  const secondRetry = await executeJsQuery(
    test.pool,
    transport,
    { ...retryRequest, testDispatchAt: at("2100-01-01T00:00:58.000Z") },
  );
  assert.equal(secondRetry.kind, "deferred");
  if (secondRetry.kind === "deferred") {
    assert.equal(secondRetry.retryAt.toISOString(), "2100-01-01T00:01:28.000Z");
  }
  assert.equal(wireHits, 2);
  assert.deepEqual(
    (await test.pool.query("SELECT reserved,consumed,wire_limit FROM budget_days WHERE day_utc='2100-01-01'"))
      .rows[0],
    { reserved: 0, consumed: 1, wire_limit: 1 },
  );
  await approveCap(0);
  const blockedRetry = await executeJsQuery(
    test.pool,
    transport,
    { ...retryRequest, testDispatchAt: at("2100-01-01T00:01:28.000Z") },
  );
  assert.equal(blockedRetry.kind, "budget_blocked");
  assert.equal(wireHits, 2, "Every due retry must consume the current approved daily cap");

  // Given two deferred retries, when the third confirmed 5xx finishes, then no fourth wire request is possible.
  const exhaustedStart = at("2100-01-02T00:00:00.000Z");
  const exhaustedRequest = request(exhaustedStart, 3, { exhausted: true }, "retry-exhausted");
  await approveCap(3);
  wireHits = 0;
  plannedResponses = [{ status: 429 }, { status: 500 }, { status: 500 }];
  assert.equal((await executeJsQuery(test.pool, transport, exhaustedRequest)).kind, "deferred");
  assert.equal(
    (
      await executeJsQuery(test.pool, transport, {
        ...exhaustedRequest,
        testDispatchAt: at("2100-01-02T00:00:05.000Z"),
      })
    ).kind,
    "deferred",
  );
  assert.equal(
    (
      await executeJsQuery(test.pool, transport, {
        ...exhaustedRequest,
        testDispatchAt: at("2100-01-02T00:00:35.000Z"),
      })
    ).kind,
    "http_failed",
  );
  assert.equal(wireHits, 3);
  const exhaustedAgain = await executeJsQuery(test.pool, transport, {
    ...exhaustedRequest,
    testDispatchAt: at("2100-01-02T00:01:05.000Z"),
  });
  assert.equal(exhaustedAgain.kind, "already_handled");
  if (exhaustedAgain.kind === "already_handled") assert.equal(exhaustedAgain.reason, "failed");
  assert.equal(wireHits, 3, "Maximum two extra retries prevents a fourth wire request");

  // Given a dispatching process is killed before a response, when recovery runs, then a new day cannot resend the unknown request.
  const hangAt = at("2100-01-03T00:00:00.000Z");
  await approveCap(3);
  hangingChild = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/hang-js-query.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: test.databaseUrl,
        JS_SIMULATOR_ORIGIN: origin,
        TEST_DISPATCH_AT: hangAt.toISOString(),
        TEST_ACCOUNT_SCOPE: `budget-kill:${test.runId}`,
      },
      stdio: "ignore",
    },
  );
  const exitedHang = once(hangingChild, "close");
  await Promise.race([
    receivedHang.promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture never received request")), 10_000);
      receivedHang.promise.finally(() => clearTimeout(timer));
    }),
  ]);
  hangingChild.kill("SIGKILL");
  await exitedHang;
  await recoverDispatchingAttempts(test.pool);
  const unknownRetry = await executeJsQuery(
    test.pool,
    transport,
    request(at("2100-01-04T00:00:00.000Z"), 3, { hang: true }, "budget-kill"),
  );
  assert.equal(unknownRetry.kind, "already_handled");
  if (unknownRetry.kind === "already_handled") assert.equal(unknownRetry.reason, "unknown");
  heldResponse?.end("{}");

  const dead = createPool(test.databaseUrl);
  await dead.end();
  assert.equal(
    (await executeJsQuery(test.pool, transport, request(at("2100-01-05T00:00:00.000Z"), 3, { dbFail: true }))).kind,
    "succeeded",
  );
  assert.equal(
    (await executeJsQuery(dead, transport, request(at("2100-01-05T00:00:01.000Z"), 3, { dbFail: true }))).kind,
    "db_unavailable",
  );

  await approveCap(1000);
  const expiring=request(at("2101-01-01T00:00:00.000Z"),1000,{expiry:true},"expiry");
  plannedResponses=[{status:200,body:{version:1}}];
  const initialCache=await executeJsQuery(test.pool,transport,expiring);
  assert.equal(initialCache.kind,"succeeded");
  await test.pool.query("UPDATE api_cache SET stored_at=now()-interval '25 hours' WHERE fingerprint=$1",[initialCache.fingerprint]);
  const beforeRefresh=wireHits;
  plannedResponses=[{status:200,body:{version:2}}];
  const refreshed=await executeJsQuery(test.pool,transport,{...expiring,testDispatchAt:at("2101-01-01T00:00:02.000Z")});
  assert.equal(refreshed.kind,"succeeded","An expired successful cache must collect fresh data");
  assert.equal(wireHits,beforeRefresh+1);
  if(refreshed.kind==="succeeded")assert.deepEqual(refreshed.body,{version:2});
  assert.equal((await test.pool.query("SELECT generation FROM api_cache WHERE fingerprint=$1",[initialCache.fingerprint])).rows[0].generation,2);
  assert.equal((await test.pool.query("SELECT count(*)::int AS count FROM api_operations WHERE fingerprint=$1",[initialCache.fingerprint])).rows[0].count,2,"Cache renewal creates a new logical generation");

  const hintClock=at("2030-01-01T00:00:00.000Z");
  assert.equal(retryNotBefore({retryNumber:1,retryAfter:null,body:null,now:hintClock}).toISOString(),"2030-01-01T00:00:05.000Z");
  assert.equal(retryNotBefore({retryNumber:2,retryAfter:null,body:null,now:hintClock}).toISOString(),"2030-01-01T00:00:30.000Z");
  assert.equal(retryNotBefore({retryNumber:1,retryAfter:"120",body:null,now:hintClock}).toISOString(),"2030-01-01T00:02:00.000Z");
  assert.equal(retryNotBefore({retryNumber:1,retryAfter:null,body:{error:"retry again at 2030-01-01T00:10:00.000Z"},now:hintClock}).toISOString(),"2030-01-01T00:10:00.000Z");
  await test.pool.query("UPDATE api_cache SET stored_at=now()-interval '25 hours' WHERE fingerprint=$1",[initialCache.fingerprint]);
  const lost=await executeJsQuery(test.pool,{kind:"ready",send:async()=>{throw new Error("Synthetic lost response");}},{...expiring,testDispatchAt:at("2101-01-02T00:00:00.000Z")});
  assert.equal(lost.kind,"outcome_unknown");
  const generationCount=(await test.pool.query("SELECT count(*)::int AS count FROM api_operations WHERE fingerprint=$1",[initialCache.fingerprint])).rows[0].count;
  const beforeBlocked=wireHits;
  const blockedRenewal=await executeJsQuery(test.pool,transport,{...expiring,testDispatchAt:at("2101-01-03T00:00:00.000Z")});
  assert.equal(blockedRenewal.kind,"already_handled");
  if(blockedRenewal.kind==="already_handled")assert.equal(blockedRenewal.reason,"unknown");
  assert.equal(wireHits,beforeBlocked);
  assert.equal((await test.pool.query("SELECT count(*)::int AS count FROM api_operations WHERE fingerprint=$1",[initialCache.fingerprint])).rows[0].count,generationCount,"An unknown refreshed generation cannot be bypassed");

  await approveCap(2);
  const lowCapTimes=["2102-01-01T23:59:59.900Z","2102-01-02T00:00:00.100Z","2102-01-02T00:00:00.200Z"];
  const lowCapResults=[];
  for(const [index,stamp] of lowCapTimes.entries())lowCapResults.push(await executeJsQuery(test.pool,transport,request(at(stamp),2,{lowCap:index},"low-cap-window")));
  assert.equal(lowCapResults[0]?.kind,"succeeded");assert.equal(lowCapResults[1]?.kind,"succeeded");
  assert.equal(lowCapResults[2]?.kind,"deferred","A lower approved cap also bounds rolling windows across UTC reset");

  console.log(
    JSON.stringify({
      scenario: "budget-rate-retry",
      result: "PASS",
      database: test.database,
      runId: test.runId,
      localHttpOnly: true,
      rateLimits: { perSecond: 15, perMinute: 300, accountBound: true },
      retry: { maxExtraAttempts: 2, persistedAcrossProcess: true, utcReauthorized: true, responseReceiptBackoff: true },
      unknownNeverResent: true,
      expiredCacheRenewsGeneration: true,
      deletedRows: 0,
    }),
  );
} finally {
  if (hangingChild && hangingChild.exitCode === null && hangingChild.signalCode === null) {
    hangingChild.kill("SIGKILL");
  }
  heldResponse?.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await test.close();
}
