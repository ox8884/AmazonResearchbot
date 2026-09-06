import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INITIAL_SETTINGS,
  evaluateNiche,
  evaluateShare,
  foldParentRevenue,
  measured,
  parseNumericCell,
  unknown,
} from "@forge-ops/domain";
import { createPool } from "@forge-ops/db";

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

const missing = parseNumericCell(null, "s", "t");
assert(missing.kind === "unknown" && missing.value === null, "null became a number");
const empty = parseNumericCell("", "s", "t");
assert(empty.kind === "unknown", "empty became a number");
const lt = parseNumericCell("< 450", "s", "t");
assert(lt.kind === "unknown" && lt.reason.includes("450"), "< 450 must stay unknown");
assert(lt.reason.includes("inequality"), "< 450 reason");
const ok = parseNumericCell("12", "s", "t");
assert(ok.kind === "measured" && ok.value === "12", "12 should be measured");

const hardFail = evaluateNiche(
  {
    review700Count: measured(1, "s", "t"),
    review2000Count: measured(2, "s", "t"),
    topPriceUsd: measured("20", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(hardFail.hardFail && hardFail.outcome === "reject", "2x 2000+ must hard-fail");

const oneHigh = evaluateNiche(
  {
    review700Count: measured(1, "s", "t"),
    review2000Count: measured(1, "s", "t"),
    topPriceUsd: measured("20", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(!oneHigh.hardFail, "1x 2000+ is not hard-fail");

const hold = evaluateNiche(
  {
    review700Count: measured(1, "s", "t"),
    review2000Count: measured(0, "s", "t"),
    topPriceUsd: measured("20", "s", "t"),
    monthlyRevenueCompetitorCount: unknown("missing"),
    standardSize: unknown("missing"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(hold.outcome === "hold", `pass3/unknown2 should hold, got ${hold.outcome}`);

const edgeLow = evaluateNiche(
  {
    review700Count: measured(0, "s", "t"),
    review2000Count: measured(0, "s", "t"),
    topPriceUsd: measured("17", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(edgeLow.outcome === "pass", "price 17 inclusive");
const edgeHigh = evaluateNiche(
  {
    review700Count: measured(0, "s", "t"),
    review2000Count: measured(0, "s", "t"),
    topPriceUsd: measured("80", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(edgeHigh.outcome === "pass", "price 80 inclusive");

const share = evaluateShare(
  {
    top1Pct: measured("35", "s", "t"),
    top3Pct: measured("55", "s", "t"),
    firstPageSalesUsd: measured("350000", "s", "t"),
  },
  {
    top1MustBeBelowPct: "35",
    top3MustBeBelowPct: "55",
    firstPageSalesMinUsd: "350000",
  },
);
assert(share.top1 === "fail", "share 35 is not < 35");
assert(share.top3 === "fail", "share 55 is not < 55");
assert(share.firstPageSales === "pass", "350000 meets min");

const folded = foldParentRevenue([
  { asin: "B1", parentAsin: "P", isVariant: true, revenue: "100" },
  { asin: "B2", parentAsin: "P", isVariant: true, revenue: "100" },
  { asin: "B3", parentAsin: "P", isVariant: true, revenue: "100" },
]);
assert(folded.kind === "known" && folded.total === "100" && folded.families === 1, "variants must not triple-count");

const origin = `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;
const email = process.env.BOOTSTRAP_EMAIL ?? "jay@local.test";
const password = process.env.BOOTSTRAP_PASSWORD;
if (!password) throw new Error("BOOTSTRAP_PASSWORD missing");

function totp(secretB32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  const s = secretB32.replace(/=+$/, "").toUpperCase();
  for (const ch of s) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(bytes);
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

const jar: string[] = [];
function cookieHeader() {
  return jar.map((c) => c.split(";")[0]).join("; ");
}
function store(res: Response) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0] ?? "";
    const name = pair.split("=")[0];
    const kept = jar.filter((x) => !x.startsWith(`${name}=`));
    jar.splice(0, jar.length, ...kept, pair);
  }
}
async function api(pathName: string, init: RequestInit = {}) {
  const res = await fetch(`${origin}${pathName}`, {
    ...init,
    headers: {
      ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
      cookie: cookieHeader(),
      origin,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  store(res);
  const body = await res.json().catch(() => null);
  return { res, body };
}

const signed = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
if (signed.body?.twoFactorRedirect) {
  const secret = process.env.BOOTSTRAP_TOTP_SECRET;
  if (!secret) throw new Error("BOOTSTRAP_TOTP_SECRET missing");
  await api("/api/auth/two-factor/verify-totp", { method: "POST", body: JSON.stringify({ code: totp(secret) }) });
}
const session = await api("/api/session");
if (session.res.status !== 200) throw new Error("sign-in required for evidence CSV");

const csv = await readFile(path.join(root, "tests/fixtures/evidence-cells.csv"));
const form = new FormData();
form.append("file", new Blob([csv], { type: "text/csv" }), "evidence-cells.csv");
const uploaded = await fetch(`${origin}/api/imports`, {
  method: "POST",
  headers: { cookie: cookieHeader(), origin },
  body: form,
});
if (!uploaded.ok) throw new Error(`evidence csv import ${uploaded.status}`);

const pool = createPool(process.env.DATABASE_URL ?? "");
const rows = await pool.query<{ keyword_raw: string; field: string; kind: string; value_text: string | null; reason: string | null }>(
  `SELECT ir.keyword_raw, e.field, e.kind, e.value_text, e.reason
   FROM import_rows ir
   JOIN candidate_import_rows cir ON cir.import_row_id = ir.id
   JOIN evidence e ON e.candidate_id = cir.candidate_id
   WHERE e.field = 'reviews'`,
);
await pool.end();
const byKw: Record<string, { kind: string; value_text: string | null; reason: string | null }> = {};
for (const row of rows.rows) byKw[row.keyword_raw] = row;
assert(byKw["lt-reviews"]?.kind === "unknown", "CSV < 450 stored unknown");
assert(byKw["lt-reviews"]?.value_text == null, "CSV < 450 must not store 450");
assert(byKw["empty-reviews"]?.kind === "unknown", "empty reviews unknown");
assert(byKw["ok-reviews"]?.kind === "measured" && byKw["ok-reviews"]?.value_text === "12", "12 measured");

console.log(
  JSON.stringify(
    {
      scenario: "evidence",
      unknownPreserved: true,
      hardFail2: true,
      inclusivePrice: true,
      shareStrictLess: true,
      parentDedupe: folded.kind === "known" ? folded.total : "unknown",
    },
    null,
    2,
  ),
);
