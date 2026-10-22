import { quoteView } from "../apps/api/src/quote-store.ts";
import assert from "node:assert/strict";
import { COST_FIELDS } from "../packages/domain/src/sourcing.ts";
import { openAcceptance } from "./support/acceptance.mjs";
import { importCsv } from "./support/import-csv.mjs";
// Runs on the isolated acceptance database so the main development data and its approved settings stay untouched.
const test = await openAcceptance();
async function call(path, body, override = {}) {
  const response = await test.call(path, body, override);
  return { status: response.status, data: response.body };
}
assert.equal((await call("/api/session")).data.user.twoFactorEnabled, true);
const settings = await call("/api/settings");
assert.equal(settings.status, 200);
assert.equal(
  settings.data.snapshot.jsDailyWireCap,
  0,
  "Local wire cap must remain zero",
);
assert.equal(
  Number(settings.data.snapshot.launchBudgetUsd),
  3000,
  "Expected approved fixture budget3000; no settings modified",
);
const keyword = "QA 견적 계산 검증 · 실제 제품 아님";
const otherKeyword = "QA 사양 격리 검증 · 실제 제품 아님";
let list = (await call("/api/candidates")).data.candidates;
const missing = [keyword, otherKeyword].filter((k) => !list.some((c) => c.keyword === k));
if (missing.length) {
  const imported = await importCsv(test, "synthetic-quote-economics.csv", Buffer.from(`keyword\n${missing.join("\n")}\n`));
  assert.equal(imported.status, 200, "Synthetic candidate import failed");
  list = (await call("/api/candidates")).data.candidates;
}
const candidate = list.find((c) => c.keyword === keyword);
assert.ok(candidate);
const prefix = `/api/candidates/${candidate.id}`;
const source =
  `합성 인수 검증용 v${settings.data.version} · 실제 제품/공급처/견적 아님 · 별도 선지급은 도착원가와 중복되지 않음`;
let view = await call(prefix + "/sourcing");
assert.equal(view.status, 200);
let spec = view.data.specs.find((s) => s.source === source);
if (!spec) {
  const created = await call(prefix + "/specs", {
    material: "실리콘 (합성 검증)",
    dimensions: "30 cm · 검증용 사양",
    packaging: "단품 포장 · 합성",
    requirements: "합성 데이터 산술 검증만 수행",
    requestedQuantity: 300,
    source,
  });
  assert.equal(created.status, 201);
  spec = created.data;
}
const observed = new Date().toISOString();
const validUntil = new Date(Date.now() + 90 * 86400000)
  .toISOString()
  .slice(0, 10);
const numbers = {
  salePrice: "30",
  productUnitPrice: "5",
  unitFreight: "1",
  unitDuty: "0",
  unitPrepInspection: "0",
  otherLandedUnitCost: "0",
  fbaFee: "4.5",
  referralFee: "4.5",
  adsPerUnit: "2",
  expectedReturnLoss: "0.5",
  otherVariableCost: "0.5",
  separateUpfrontCosts: "200",
  initialAdCash: "300",
  contingencyCash: "300",
};
const costs = Object.fromEntries(
  COST_FIELDS.map((field) => [
    field,
    {
      value: numbers[field],
      kind: ["productUnitPrice", "unitFreight"].includes(field)
        ? "quote"
        : "estimate",
      source: `${source}; ${field}=${numbers[field]} USD 명시적 합성값`,
      observedAt: observed,
    },
  ]),
);
const a = {
  specId: spec.id,
  supplierName: "합성 견적 A · 실제 업체 아님",
  supplierSource: "PLAN.md 합성 A",
  sourceText: source,
  receivedAt: observed,
  validUntil,
  incoterm: "FOB · 합성 단위 운임1 USD",
  quantity: 300,
  moq: 300,
  risksConfirmed: true,
  riskSource: "합성 검증의 위험 통과 가정이며 실제 위험 확인 자료가 아님",
  costs,
};
async function save(input) {
  const existing = (await call(prefix + "/sourcing")).data.quotes.find(
    (q) =>
      q.specId === spec.id &&
      q.supplierName === input.supplierName &&
      q.sourceText === source,
  );
  if (existing) return existing;
  const r = await call(prefix + "/quotes", input);
  assert.equal(
    r.status,
    201,
    `Quote creation failed: ${r.data.code ?? r.status}`,
  );
  return r.data;
}
const qa = await save(a);
assert.equal(qa.assessment.outcome, "GO");
assert.equal(Number(qa.assessment.totals.launchCash), 2600);
assert.equal(Number(qa.assessment.totals.afterAds), 12);
assert.equal(Number(qa.assessment.totals.roiPct), 200);
const qb = await save({
  ...a,
  supplierName: "합성 견적 B · 실제 업체 아님",
  quantity: 600,
  moq: 600,
  costs: {
    ...costs,
    productUnitPrice: {
      ...costs.productUnitPrice,
      value: "4",
      source: `${source}; productUnitPrice=4 USD 합성값`,
    },
  },
});
assert.equal(qb.assessment.outcome, "CAUTION");
assert.equal(Number(qb.assessment.totals.launchCash), 3800);
assert.equal(Number(qb.assessment.totals.afterAds), 13);
assert.equal(Number(qb.assessment.totals.roiPct), 260);
const hold = await save({
  ...a,
  supplierName: "합성 견적 C · 운임 미확인",
  costs: {
    ...costs,
    unitFreight: {
      value: null,
      kind: "unknown",
      source: null,
      observedAt: null,
      reason: "운임 미확인",
    },
  },
});
assert.equal(hold.assessment.outcome, "HOLD");
assert.equal(hold.assessment.totals, null);
const reread = await call(prefix + "/sourcing");
assert.equal(reread.status, 200);
assert.ok(
  reread.data.quotes.some(
    (q) =>
      q.id === qa.id &&
      q.quantity === 300 &&
      q.costs.productUnitPrice.value === "5",
  ),
);
assert.ok(
  reread.data.quotes.some(
    (q) =>
      q.id === qb.id &&
      q.quantity === 600 &&
      q.costs.productUnitPrice.value === "4",
  ),
);
assert.equal(
  (await call(prefix + "/quotes", { ...a, quantity: 0 })).status,
  400,
);
assert.equal(
  (await call(prefix + "/quotes", { ...a, quantity: 1, moq: 300 })).status,
  400,
);
assert.equal(
  (
    await call(prefix + "/quotes", {
      ...a,
      costs: { ...costs, fbaFee: { ...costs.fbaFee, source: "" } },
    })
  ).status,
  400,
);
assert.equal(
  (await call(prefix + "/quotes", a, { origin: "https://unapproved.invalid" }))
    .status,
  403,
);
assert.equal(
  (await call(prefix + "/sourcing", undefined, { cookie: "" })).status,
  401,
);
assert.equal(
  (await call("/api/settings")).data.version,
  settings.data.version,
  "Settings must remain unchanged",
);
const other = list.find(c=>c.id!==candidate.id);
assert.ok(other);
assert.equal((await call('/api/candidates/'+other.id+'/quotes',a)).status,404,'A specification cannot be attached to another candidate');
try {
  const result=await test.pool.query('SELECT *,valid_until::text AS valid_until FROM supplier_quotes WHERE id=$1',[qa.id]);
  const changed=quoteView(result.rows[0],{version:settings.data.version+1,snapshot:{...settings.data.snapshot,launchBudgetUsd:'2500'}});
  assert.equal(changed.stale,true);
  assert.equal(changed.assessment.outcome,'CAUTION');
  assert.equal(changed.savedAssessment.outcome,'GO');
  assert.equal(changed.savedSettingsVersion,settings.data.version);
} finally {await test.close();}
console.log(
  JSON.stringify(
    {
      result: "PASS",
      candidateId: candidate.id,
      specId: spec.id,
      A: { outcome: qa.assessment.outcome, totals: qa.assessment.totals },
      B: { outcome: qb.assessment.outcome, totals: qb.assessment.totals },
      unknownFreight: hold.assessment.outcome,
      validation: "invalid qty/MOQ/provenance rejected",
      authorization: "wrong origin and no session rejected",
      externalCalls: 0,
      specIsolation: "PASS",
      staleEvaluation: "PASS: in-memory next settings, saved assessment preserved, DB settings unchanged",
      testData:
        "Three clearly labeled synthetic quote records retained; no existing data deleted",
    },
    null,
    2,
  ),
);
