import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv.includes("--scenario")
  ? process.argv[process.argv.indexOf("--scenario") + 1]
  : "csv20";

function loadEnv(text) {
  const out = { ...process.env };
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (out[k] == null) out[k] = v;
  }
  return out;
}

const env = loadEnv(await readFile(path.join(root, ".env"), "utf8"));
const origin = `http://127.0.0.1:${env.API_PORT ?? 3001}`;
function runTs(file) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", file], { cwd: root, stdio: "inherit", shell: true, env: process.env });
    child.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${file} exited ${code}`));
    });
  });
}

if (scenario === "evidence") {
  await runTs("scripts/verify-evidence.ts");
  process.exit(0);
}
if (scenario === "budget") {
  await runTs("scripts/verify-budget.ts");
  process.exit(0);
}
if (scenario !== "csv20" && scenario !== "all") {
  console.log(`scenario ${scenario}: not implemented (skipped)`);
  process.exit(0);
}

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://127.0.0.1:3001/api/health");
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("API가 응답하지 않습니다. 먼저 pnpm dev를 실행하세요.");
}

function totp(secretB32, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  const s = secretB32.replace(/=+$/, "").toUpperCase();
  for (const ch of s) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(bytes);
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

await waitHealth();
const jar = [];

function cookieHeader() {
  return jar.map((c) => c.split(";")[0]).join("; ");
}

function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const pair = c.split(";")[0] ?? "";
    const name = pair.split("=")[0];
    if (!name) continue;
    const kept = [];
    for (const existing of jar) {
      if (!existing.startsWith(`${name}=`)) kept.push(existing);
    }
    jar.splice(0, jar.length, ...kept, pair);
  }
}

async function api(pathName, init = {}) {
  const res = await fetch(`${origin}${pathName}`, {
    ...init,
    headers: {
      ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}),
      cookie: cookieHeader(),
      origin: origin,
      ...init.headers,
    },
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

const email = env.BOOTSTRAP_EMAIL ?? "jay@local.test";
const password = env.BOOTSTRAP_PASSWORD;
if (!password) throw new Error("BOOTSTRAP_PASSWORD missing");

async function saveTotpSecret(secret) {
  const envPath = path.join(root, ".env");
  let text = await readFile(envPath, "utf8");
  if (/^BOOTSTRAP_TOTP_SECRET=/m.test(text)) {
    text = text.replace(/^BOOTSTRAP_TOTP_SECRET=.*$/m, `BOOTSTRAP_TOTP_SECRET=${secret}`);
  } else {
    text += `BOOTSTRAP_TOTP_SECRET=${secret}\n`;
  }
  await writeFile(envPath, text);
  env.BOOTSTRAP_TOTP_SECRET = secret;
}

async function completeTotp(secret) {
  const verified = await api("/api/auth/two-factor/verify-totp", {
    method: "POST",
    body: JSON.stringify({ code: totp(secret) }),
  });
  if (verified.res.status >= 400) {
    throw new Error(`2FA verify failed (${verified.res.status})`);
  }
}

let session = await api("/api/session");
if (session.res.status === 401) {
  await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "Jay" }) });
  const signed = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  if (signed.body?.twoFactorRedirect) {
    const secret = env.BOOTSTRAP_TOTP_SECRET;
    if (!secret) throw new Error("2FA required but BOOTSTRAP_TOTP_SECRET missing");
    await completeTotp(secret);
  }
  session = await api("/api/session");
}

if (!session.body?.user?.twoFactorEnabled) {
  const enabled = await api("/api/auth/two-factor/enable", {
    method: "POST",
    body: JSON.stringify({ password, method: "totp" }),
  });
  const uri = enabled.body?.totpURI ?? "";
  if (!uri.startsWith("otpauth://")) {
    throw new Error(`2FA enable failed (${enabled.res.status})`);
  }
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("2FA enable missing secret");
  await saveTotpSecret(secret);
  await completeTotp(secret);
  session = await api("/api/session");
}

if (session.res.status !== 200 || !session.body?.user?.twoFactorEnabled) {
  throw new Error("session not ready with 2FA");
}

const csvPath = path.join(root, "tests/fixtures/opportunity-finder-20.csv");
const csv = await readFile(csvPath);
const keywords = new Set(
  csv
    .toString("utf8")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(",")[0]?.trim())
    .filter(Boolean),
);
function ofFile(list) {
  return list.filter((c) => keywords.has(c.keyword));
}
const t0 = new Date().toISOString();
const form = new FormData();
form.append("file", new Blob([csv], { type: "text/csv" }), "opportunity-finder-20.csv");
const uploaded = await fetch(`${origin}/api/imports`, {
  method: "POST",
  headers: { cookie: cookieHeader(), origin: origin },
  body: form,
});
storeCookies(uploaded);
const uploadBody = await uploaded.json();
if (!uploaded.ok && uploaded.status !== 200) {
  throw new Error(`import failed ${uploaded.status} ${JSON.stringify(uploadBody)}`);
}

let candidates = [];
for (let i = 0; i < 40; i++) {
  const list = await api("/api/candidates");
  candidates = ofFile(list.body?.candidates ?? []);
  if (candidates.length === 20 && candidates.every((c) => c.nextAction && c.stage)) break;
  await new Promise((r) => setTimeout(r, 500));
}

if (candidates.length !== 20) {
  throw new Error(`expected 20 candidates, got ${candidates.length}`);
}
for (const c of candidates) {
  if (!c.nextAction || !c.stage || !c.keyword) throw new Error(`candidate missing view fields ${JSON.stringify(c)}`);
}

const again = await fetch(`${origin}/api/imports`, {
  method: "POST",
  headers: { cookie: cookieHeader(), origin: origin },
  body: (() => {
    const f = new FormData();
    f.append("file", new Blob([csv], { type: "text/csv" }), "opportunity-finder-20.csv");
    return f;
  })(),
});
const againBody = await again.json();
const againList = ofFile(againBody.candidates ?? (await api("/api/candidates")).body.candidates);
if (againList.length !== 20) throw new Error(`reupload created ${againList.length} not 20`);

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const one = candidates[0];
await pool.query(`UPDATE candidates SET blocked_reason = 'web_session' WHERE id = $1`, [one.id]);
const afterBlock = ofFile((await api("/api/candidates")).body.candidates);
const blocked = afterBlock.find((c) => c.id === one.id);
const others = afterBlock.filter((c) => c.id !== one.id);
if (blocked.nextAction.target !== "web_session") throw new Error("web_session wait not applied");
if (others.some((c) => c.nextAction.target === "web_session")) {
  throw new Error("blocking one candidate stalled others");
}
const wires = await pool.query(`SELECT count(*)::int AS n FROM api_attempts WHERE created_at > $1::timestamptz`, [t0]);
if (wires.rows[0].n !== 0) throw new Error(`paid/wire attempts ${wires.rows[0].n} expected 0`);
await pool.end();

console.log(
  JSON.stringify(
    {
      scenario: "csv20",
      candidates: 20,
      nextAction: "1 each",
      reupload: 20,
      independentWait: true,
      wireAttempts: 0,
    },
    null,
    2,
  ),
);

if (scenario === "all") {
  await runTs("scripts/verify-evidence.ts");
  await runTs("scripts/verify-budget.ts");
}
