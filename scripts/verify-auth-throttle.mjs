import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createDb, createPool } from "../packages/db/src/index.ts";
import { createAuth } from "../apps/api/src/auth.ts";
import { createAuthThrottle } from "../apps/api/src/auth-throttle.ts";
import { openAcceptance } from "./support/acceptance.mjs";

const secret = randomBytes(32).toString("hex");
const password = randomBytes(24).toString("base64url");

function signCookie(value) {
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64")}`;
}

function directAuthRequest(origin, path, body, cookieHeader, requestOrigin = origin) {
  const headers = { "content-type": "application/json", origin: requestOrigin };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new Request(`${origin}/api/auth${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function setCookies(response) {
  const getter = Reflect.get(response.headers, "getSetCookie");
  if (typeof getter === "function") return getter.call(response.headers);
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

function twoFactorCookie(response) {
  const cookie = setCookies(response).find((value) =>
    /^(?:__Secure-)?better-auth\.two_factor=/.test(value),
  );
  assert.ok(cookie, "Better Auth sign-in must issue a two-factor challenge cookie");
  return cookie.slice(0, cookie.indexOf(";"));
}

function sessionCookie(response) {
  const cookie = setCookies(response).find((value) =>
    /^(?:__Secure-)?better-auth\.session_token=/.test(value),
  );
  assert.ok(cookie, "Better Auth sign-up must issue a session cookie");
  return cookie.slice(0, cookie.indexOf(";"));
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const value = alphabet.indexOf(character);
    assert.ok(value >= 0, "TOTP secret must be base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function tamperCookie(cookie) {
  const nameSeparator = cookie.indexOf("=");
  const value = cookie.slice(nameSeparator + 1);
  const signatureSeparator = value.lastIndexOf(".");
  const signature = value.slice(signatureSeparator + 1);
  const replacement = signature.startsWith("A") ? "B" : "A";
  return `${cookie.slice(0, nameSeparator + 1)}${value.slice(0, signatureSeparator + 1)}${replacement}${signature.slice(1)}`;
}

function passwordInput(email, ip) {
  return {
    method: "POST",
    pathname: "/api/auth/sign-in/email",
    ip,
    body: { email, password: "fixture-password-not-logged" },
  };
}

async function failedPassword(throttle, email, ip) {
  return throttle.run(passwordInput(email, ip), async () => ({ status: 401 }));
}

async function expectHandled(result) {
  assert.equal(result.kind, "handled");
  assert.equal(result.response.status, 401);
}

const test = await openAcceptance();
let restartPool;
let singleConnectionPool;
try {
  const localSession = await test.call("/api/session");
  assert.equal(localSession.status, 200);
  assert.equal(localSession.body.user.twoFactorEnabled, true);

  const origin = "http://localhost:5173";
  const auth = createAuth(createDb(test.pool), {
    appEnv: "development",
    databaseUrl: test.databaseUrl,
    webOrigin: origin,
    apiPort: 3001,
    authSecret: secret,
    encryptionKeyHex: randomBytes(32).toString("hex"),
    jsDailyWireCap: 0,
    mailTransport: "disabled",
  });
  const email = `auth-throttle-${test.runId}@fixture.invalid`;
  const signup = await auth.handler(
    directAuthRequest(origin, "/sign-up/email", { email, password, name: "Auth throttle fixture" }),
  );
  assert.equal(signup.status, 200);
  const signupSessionCookie = sessionCookie(signup);

  const user = await test.pool.query("SELECT id FROM \"user\" WHERE email = $1", [email]);
  const userId = user.rows[0]?.id;
  assert.equal(typeof userId, "string");
  await test.pool.query("UPDATE \"user\" SET two_factor_enabled = true WHERE id = $1", [userId]);
  await test.pool.query(
    `INSERT INTO two_factor(id, secret, user_id, verified)
     VALUES($1, $2, $3, true)`,
    [randomUUID(), "JBSWY3DPEHPK3PXP", userId],
  );

  assert.equal(await auth.api.getSession({headers:new Headers({cookie:signupSessionCookie})}),null,"Pre-enrollment signup session is revoked when two-factor state changes");

  const firstChallenge = await auth.handler(
    directAuthRequest(origin, "/sign-in/email", { email, password }),
  );
  assert.equal(firstChallenge.status, 200);
  const firstChallengeCookie = twoFactorCookie(firstChallenge);

  const trustedSessionAccount = async (input) => {
    if (!input.sessionHeaders) return null;
    const session = await auth.api.getSession({ headers: input.sessionHeaders });
    return session?.user.email ?? null;
  };
  const throttle = createAuthThrottle({
    pool: test.pool,
    authSecret: secret,
    resolveTrustedSessionAccount: trustedSessionAccount,
  });

  const enrollmentEmail = `enrollment-${test.runId}@fixture.invalid`;
  const enrollmentSignup = await auth.handler(
    directAuthRequest(origin, "/sign-up/email", {
      email: enrollmentEmail,
      password,
      name: "Initial TOTP enrollment fixture",
    }),
  );
  assert.equal(enrollmentSignup.status, 200);
  const enrollmentSessionCookie = sessionCookie(enrollmentSignup);
  const enabledEnrollment = await auth.handler(
    directAuthRequest(origin, "/two-factor/enable", { password, method: "totp" }, enrollmentSessionCookie),
  );
  assert.equal(enabledEnrollment.status, 200);
  const enrollmentSecret = new URL((await enabledEnrollment.json()).totpURI).searchParams.get("secret");
  assert.ok(enrollmentSecret, "Better Auth must return the enrollment TOTP secret");
  const enrollmentHeaders = new Headers({ cookie: enrollmentSessionCookie });
  const enrolled = await throttle.run(
    {
      method: "POST",
      pathname: "/api/auth/two-factor/verify-totp",
      ip: "198.51.100.39",
      cookieHeader: enrollmentSessionCookie,
      sessionHeaders: enrollmentHeaders,
      body: { code: totp(enrollmentSecret) },
    },
    () =>
      auth.handler(
        directAuthRequest(
          origin,
          "/two-factor/verify-totp",
          { code: totp(enrollmentSecret) },
          enrollmentSessionCookie,
        ),
      ),
  );
  assert.equal(enrolled.kind, "handled");
  assert.equal(enrolled.response.status, 200);
  const enrollmentAttempt = await test.pool.query(
    "SELECT success FROM login_attempts WHERE email_normalized = $1 AND ip = $2 ORDER BY created_at DESC LIMIT 1",
    [enrollmentEmail, "198.51.100.39"],
  );
  assert.equal(enrollmentAttempt.rows[0]?.success, true);
  const totpIp = "198.51.100.40";
  const firstTotpInput = {
    method: "POST",
    pathname: "/api/auth/two-factor/verify-totp",
    ip: totpIp,
    cookieHeader: firstChallengeCookie,
    body: { account: "attacker@example.invalid", code: "000000" },
  };
  for (let index = 0; index < 4; index += 1) {
    await expectHandled(await throttle.run(firstTotpInput, async () => ({ status: 401 })));
  }

  const refreshedChallenge = await auth.handler(
    directAuthRequest(origin, "/sign-in/email", { email, password }),
  );
  assert.equal(refreshedChallenge.status, 200);
  const refreshedTotpInput = { ...firstTotpInput, cookieHeader: twoFactorCookie(refreshedChallenge) };
  await expectHandled(await throttle.run(refreshedTotpInput, async () => ({ status: 401 })));
  let refreshedHandlerEntered = false;
  const refreshedBlocked = await throttle.run(refreshedTotpInput, async () => {
    refreshedHandlerEntered = true;
    return { status: 401 };
  });
  assert.equal(refreshedBlocked.kind, "blocked");
  assert.equal(refreshedBlocked.status, 423);
  assert.equal(refreshedHandlerEntered, false);

  let tamperedHandlerEntered = false;
  const tampered = await throttle.run(
    { ...firstTotpInput, cookieHeader: tamperCookie(firstChallengeCookie) },
    async () => {
      tamperedHandlerEntered = true;
      return { status: 401 };
    },
  );
  assert.equal(tampered.kind, "rejected");
  assert.equal(tampered.status, 401);
  assert.equal(tamperedHandlerEntered, false);

  let forgedHandlerEntered = false;
  const forged = await throttle.run(
    { ...firstTotpInput, cookieHeader: `better-auth.two_factor=${signCookie("2fa-forged")}` },
    async () => {
      forgedHandlerEntered = true;
      return { status: 401 };
    },
  );
  assert.equal(forged.kind, "rejected");
  assert.equal(forged.status, 401);
  assert.equal(forgedHandlerEntered, false);

  const serialEmail = `serial-${test.runId}@fixture.invalid`;
  const serialIp = "198.51.100.41";
  for (let index = 0; index < 5; index += 1) {
    await expectHandled(await failedPassword(throttle, serialEmail, serialIp));
  }
  let sixthHandlerEntered = false;
  const sixth = await throttle.run(passwordInput(serialEmail, serialIp), async () => {
    sixthHandlerEntered = true;
    return { status: 401 };
  });
  assert.equal(sixth.kind, "blocked");
  assert.equal(sixth.status, 423);
  assert.equal(sixthHandlerEntered, false);

  const concurrentEmail = `concurrent-${test.runId}@fixture.invalid`;
  const concurrentIp = "198.51.100.42";
  let concurrentEntries = 0;
  let releaseConcurrentHandlers;
  const concurrentHandlersReleased = new Promise((resolve) => {
    releaseConcurrentHandlers = resolve;
  });
  let observeFiveEntries;
  const fiveEntriesObserved = new Promise((resolve) => {
    observeFiveEntries = resolve;
  });
  const concurrentAttempts = Array.from({ length: 6 }, () =>
    throttle.run(passwordInput(concurrentEmail, concurrentIp), async () => {
      concurrentEntries += 1;
      if (concurrentEntries === 5) observeFiveEntries();
      await concurrentHandlersReleased;
      return { status: 401 };
    }),
  );
  await fiveEntriesObserved;
  assert.equal(concurrentEntries, 5);
  const reservedWhileHandlersRun = await test.pool.query(
    `SELECT count(*)::int AS count
     FROM login_attempts
     WHERE email_normalized = $1 AND ip = $2 AND success = false`,
    [concurrentEmail, concurrentIp],
  );
  assert.equal(reservedWhileHandlersRun.rows[0]?.count, 5);
  releaseConcurrentHandlers();
  const concurrentResults = await Promise.all(concurrentAttempts);
  assert.equal(concurrentResults.filter((result) => result.kind === "handled").length, 5);
  assert.equal(concurrentResults.filter((result) => result.kind === "blocked").length, 1);

  const splitEmail = `split-${test.runId}@fixture.invalid`;
  const splitIp = "198.51.100.43";
  for (let index = 0; index < 5; index += 1) {
    await expectHandled(await failedPassword(throttle, splitEmail, splitIp));
  }
  await expectHandled(await failedPassword(throttle, splitEmail, "198.51.100.44"));
  await expectHandled(await failedPassword(throttle, `other-${test.runId}@fixture.invalid`, splitIp));

  const thrownEmail = `thrown-${test.runId}@fixture.invalid`;
  const thrownIp = "198.51.100.45";
  await assert.rejects(
    throttle.run(passwordInput(thrownEmail, thrownIp), async () => {
      throw new Error("synthetic handler failure");
    }),
  );
  for (let index = 0; index < 4; index += 1) {
    await expectHandled(await failedPassword(throttle, thrownEmail, thrownIp));
  }
  const thrownBlocked = await throttle.run(passwordInput(thrownEmail, thrownIp), async () => ({ status: 401 }));
  assert.equal(thrownBlocked.kind, "blocked");

  const restartEmail = `restart-${test.runId}@fixture.invalid`;
  const restartIp = "198.51.100.46";
  for (let index = 0; index < 5; index += 1) {
    await expectHandled(await failedPassword(throttle, restartEmail, restartIp));
  }
  restartPool = createPool(test.databaseUrl);
  const restartedThrottle = createAuthThrottle({
    pool: restartPool,
    authSecret: secret,
    resolveTrustedSessionAccount: trustedSessionAccount,
  });
  const persistedBlock = await restartedThrottle.run(
    passwordInput(restartEmail, restartIp),
    async () => ({ status: 401 }),
  );
  assert.equal(persistedBlock.kind, "blocked");

  singleConnectionPool = new Pool({ connectionString: test.databaseUrl, max: 1 });
  const singleConnectionThrottle = createAuthThrottle({
    pool: singleConnectionPool,
    authSecret: secret,
    resolveTrustedSessionAccount: trustedSessionAccount,
  });
  let releaseSingleHandler;
  const singleHandlerReleased = new Promise((resolve) => {
    releaseSingleHandler = resolve;
  });
  let singleHandlerEntered;
  const singleHandlerEnteredPromise = new Promise((resolve) => {
    singleHandlerEntered = resolve;
  });
  const singleConnectionAttempt = singleConnectionThrottle.run(
    passwordInput(`connection-${test.runId}@fixture.invalid`, "198.51.100.47"),
    async () => {
      singleHandlerEntered();
      await singleHandlerReleased;
      return { status: 401 };
    },
  );
  await singleHandlerEnteredPromise;
  const poolQueryDuringHandler = await singleConnectionPool.query("SELECT 1 AS available");
  assert.equal(poolQueryDuringHandler.rows[0]?.available, 1);
  releaseSingleHandler();
  await expectHandled(await singleConnectionAttempt);

  const productionAuth = createAuth(createDb(test.pool), {
    appEnv: "production",
    databaseUrl: test.databaseUrl,
    webOrigin: "https://localhost:5173",
    apiPort: 3001,
    authSecret: randomBytes(32).toString("hex"),
    encryptionKeyHex: randomBytes(32).toString("hex"),
    jsDailyWireCap: 0,
    mailTransport: "disabled",
  });
  const productionSignup = await productionAuth.handler(
    directAuthRequest("https://localhost:5173", "/sign-up/email", {
      email: `production-${test.runId}@fixture.invalid`,
      password: randomBytes(24).toString("base64url"),
      name: "Production signup must be disabled",
    }),
  );
  assert.equal(productionSignup.status, 400);
  const productionLoopbackOrigin = await productionAuth.handler(
    directAuthRequest(
      "https://localhost:5173",
      "/sign-in/email",
      { email: "missing@fixture.invalid", password },
      undefined,
      "http://127.0.0.1:3001",
    ),
  );
  assert.equal(productionLoopbackOrigin.status, 403);
  const sessionLifetime = await test.pool.query(
    `SELECT EXTRACT(EPOCH FROM (expires_at - created_at))::int AS seconds
     FROM session
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [localSession.body.user.id],
  );
  assert.equal(sessionLifetime.rows[0]?.seconds, 43_200);

  const summary = {
    scenario: "auth-throttle-acceptance",
    result: "PASS",
    database: test.database,
    sixthBlocked: true,
    concurrentHandlerEntries: 5,
    accountIpSeparated: true,
    restartPersistence: true,
    verifiedChallengeIdentity: true,
    thrownHandlerFailsClosed: true,
    connectionReleasedBeforeHandler: true,
    localSignupFixture: true,
    initialEnrollmentSessionIdentity: true,
    preEnrollmentSessionRevoked: true,
    productionSignupDisabled: true,
    productionLoopbackOriginRejected: true,
    sessionAbsoluteTwelveHours: true,
    secretsLogged: false,
  };
  assert.equal(JSON.stringify(summary).includes(secret), false);
  console.log(JSON.stringify(summary));
} finally {
  await singleConnectionPool?.end();
  await restartPool?.end();
  await test.close();
}
