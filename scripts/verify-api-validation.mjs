import {auxiliaryFixture} from "./support/auxiliary-fixture.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openAcceptance } from "./support/acceptance.mjs";
import { consumeOfficialValidation } from "../apps/worker/src/api-validation.ts";
import { createSimulatorTransport, denyTransport } from "../packages/integrations/src/jungle-scout/transport.ts";
import { INITIAL_SETTINGS } from "../packages/domain/src/settings.ts";

const test = await openAcceptance({ databaseKey: `api-validation-${process.pid}-${Date.now().toString(36)}` });
const scenarios = new Map();
const requests = [];
const catalogFamilies = new Map();
const salesRequests = [];
let settingsVersion = Number((await test.pool.query("SELECT max(version)::int AS version FROM settings_versions")).rows[0].version);

async function settings(overrides = {}) {
  settingsVersion += 1;
  const snapshot = { ...INITIAL_SETTINGS, jsDailyWireCap: 100, ...overrides };
  await test.pool.query(
    "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'api-validation-fixture',$2::jsonb)",
    [settingsVersion, JSON.stringify(snapshot)],
  );
  return { version: settingsVersion, snapshot };
}

function product(number, overrides = {}) {
  const asin = `B0AA${String(number).padStart(6, "0")}`;
  return {
    id: `us/${asin}`,
    type: "product_database_result",
    attributes: {
      price: 25,
      reviews: 100,
      category: "Kitchen & Dining",
      parent_asin: null,
      is_variant: false,
      is_parent: false,
      variants: [],
      approximate_30_day_units_sold: 100,
      approximate_30_day_revenue: 9000,
      updated_at: "2026-09-06T12:00:00.000Z",
      ...overrides,
    },
  };
}

function officialNext(cursor) {
  return `https://developer.junglescout.com/api/product_database_query?marketplace=us&page%5Bcursor%5D=${encodeURIComponent(cursor)}`;
}

function fixture(data, next) {
  return { data, links: { next } };
}

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text=Buffer.concat(chunks).toString("utf8");
  const body = text?JSON.parse(text):null;
  const url = new URL(request.url, "http://127.0.0.1");
  const auxiliary=auxiliaryFixture(url,body);
  if(auxiliary){
    if(url.pathname==='/api/sales_estimates_query'){
      salesRequests.push(Object.fromEntries(url.searchParams));
      const family=catalogFamilies.get(url.searchParams.get('asin'));
      if(family)Object.assign(auxiliary.data[0].attributes,family);
    }
    response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify(auxiliary));return;
  }
  const keyword = body?.data?.attributes?.include_keywords?.[0];
  const scenario = scenarios.get(keyword);
  if (!scenario) {
    response.writeHead(404).end();
    return;
  }
  if (scenario.bumpSettings && !scenario.bumped) {
    scenario.bumped = true;
    await settings();
  }
  if (scenario.dropConnection) {
    request.socket.destroy();
    return;
  }
  const cursor = url.searchParams.get("page[cursor]") ?? "first";
  const page = scenario.pages.get(cursor);
  if (!page) {
    response.writeHead(404).end();
    return;
  }
  requests.push({ keyword, query: Object.fromEntries(url.searchParams), body });
  for(const row of page.data){
    const a=row.attributes;
    catalogFamilies.set(row.id.split('/')[1],{parent_asin:a.parent_asin,is_variant:a.is_variant,is_parent:a.is_parent,variants:a.variants,is_standalone:a.parent_asin===null&&a.is_variant===false&&a.is_parent===false});
    if(a.is_variant&&a.parent_asin){
      const prior=catalogFamilies.get(a.parent_asin);
      catalogFamilies.set(a.parent_asin,{parent_asin:null,is_variant:false,is_parent:true,is_standalone:false,variants:[...new Set([...(prior?.variants??[]),row.id.split('/')[1]])]});
    }
  }
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(page));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const transport = createSimulatorTransport(`http://127.0.0.1:${address.port}`, "development");

async function candidate(label, setting) {
  const keyword = `qa api validation ${label} ${test.runId}`;
  const inserted = await test.pool.query(
    "INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$2,'api_validation') RETURNING id",
    [keyword.toLowerCase(), keyword],
  );
  return {
    candidateId: inserted.rows[0].id,
    keyword,
    inputVersion: 1,
    settingsVersion: setting.version,
    snapshot: setting.snapshot,
    accountScope: `acceptance:${test.runId}:${label}`,
  };
}

async function manualNicheEvidence(candidateId) {
  await test.pool.query("INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",[candidateId,JSON.stringify({representativeAsin:'B0AA000003',actor:'fixture-manual-selection'})]);
  const observedAt = "2026-09-06T12:00:00.000Z";
  const sourceId = `manual-fixture:${test.runId}`;
  for (const [field, value] of [["top_price", "25"], ["standard_size", "true"], ["differentiation", "true"]]) {
    await test.pool.query(
      "INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at) VALUES($1,$2,'measured',$3,$4,$5)",
      [candidateId, field, value, sourceId, observedAt],
    );
  }
}

try {
  assert.equal(Number((await test.pool.query("SELECT count(*)::int AS count FROM schema_migrations WHERE id='0008_api_evidence.sql'")).rows[0].count), 1);
  const passingSettings = await settings({ productDatabaseMaxPages: 3 });
  const passing = await candidate("passing", passingSettings);
  await manualNicheEvidence(passing.candidateId);
  const parent = "B0AA999901";
  scenarios.set(passing.keyword, {
    pages: new Map([
      ["first", fixture([
        product(1, { parent_asin: parent, is_variant: true }),
        product(2, { parent_asin: parent, is_variant: true, reviews: 600 }),
        product(3, {length_value:3.5,width_value:7.9,height_value:9.2,dimensions_unit:'inches',weight_value:2.2906,weight_unit:'pounds'}),
      ], officialNext("page-two"))],
      ["page-two", fixture([product(4), product(5), product(6,{weight_value:1,weight_unit:'pounds'}), product(6,{weight_value:2,weight_unit:'pounds'})], null)],
    ]),
  });
  assert.equal(await consumeOfficialValidation(test.pool, transport, passing), "pass");
  assert.equal((await test.pool.query("SELECT stage FROM candidates WHERE id=$1", [passing.candidateId])).rows[0].stage, "sourcing");
  const passEvaluation = (await test.pool.query("SELECT outcome,payload FROM evaluations WHERE candidate_id=$1 AND kind='api_validation'", [passing.candidateId])).rows[0];
  assert.equal(passEvaluation.outcome, "pass");
  assert.equal(passEvaluation.payload.inputVersion, 1);
  assert.ok(passEvaluation.payload.input, "Assessment input snapshot missing");
  assert.equal(passEvaluation.payload.input.review2000Count.value, 0);
  assert.equal(passEvaluation.payload.evidenceBlock, null);
  const visible=await test.call(`/api/candidates/${passing.candidateId}`);
  assert.equal(visible.status,200);
  assert.equal(visible.body.validation.phase,"api_validation");
  assert.equal(visible.body.validation.status,"pass");
  assert.equal(visible.body.validation.input.review2000Count.value,0);
  assert.equal(visible.body.validation.sourceCount,12);
  assert.deepEqual(salesRequests.map(r=>r.asin).sort(),[...Array.from({length:6},(_,index)=>`B0AA${String(index+1).padStart(6,'0')}`),parent].sort());
  assert.equal(new Set(salesRequests.map(r=>r.start_date+'|'+r.end_date)).size,1,'All pages and duplicate rows must share one requested sales window');
  assert.equal((Date.parse(salesRequests[0].end_date)-Date.parse(salesRequests[0].start_date))/86400000+1,30);
  assert.equal(visible.body.validation.raw_body,undefined);
  for(const [field,value] of [['api_catalog_dimensions:B0AA000003','3.5 × 7.9 × 9.2 inches'],['api_catalog_weight:B0AA000003','2.2906 pounds']]){
    const fact=visible.body.evidence.find(e=>e.field===field);
    assert.deepEqual([fact?.kind,fact?.value_text],['measured',value]);
    assert.ok(fact.source_id.startsWith('api-validation-source:') && fact.observed_at);
  }
  assert.equal(visible.body.evidence.find(e=>e.field==='api_catalog_dimensions:B0AA000001')?.kind,'unknown');
  const conflictingWeight=visible.body.evidence.find(e=>e.field==='api_catalog_weight:B0AA000006');
  assert.equal(conflictingWeight?.kind,'unknown','Conflicting catalog values cannot pick a random latest row');
  assert.equal(conflictingWeight.reason,'CONFLICTING_CATALOG_OBSERVATIONS');
  const reviews=visible.body.evidence.find(e=>e.field==='api_catalog_reviews:B0AA000002');
  assert.equal(reviews?.value_numeric,'600','Per-ASIN review counts must be retained with official provenance');
  assert.equal(reviews.kind,'measured');assert.ok(reviews.source_id.startsWith('api-validation-source:'));
  const variants=visible.body.evidence.find(e=>e.field==='api_catalog_reported_variants:B0AA000003');
  assert.equal(variants?.value_numeric,'0','An explicitly empty variant list is a reported count, not a risk decision');

  const passRequests = requests.filter((item) => item.keyword === passing.keyword);
  assert.equal(passRequests.length, 2);
  assert.deepEqual(passRequests.map((item) => item.query), [
    { marketplace: "us", "page[size]": "100" },
    { marketplace: "us", "page[size]": "100", "page[cursor]": "page-two" },
  ]);
  assert.deepEqual(passRequests.map((item) => item.body), [
    { data: { type: "product_database_query", attributes: { categories: ["Kitchen & Dining"], include_keywords: [passing.keyword] } } },
    { data: { type: "product_database_query", attributes: { categories: ["Kitchen & Dining"], include_keywords: [passing.keyword] } } },
  ]);

  const cacheOnlySettings = await settings({ jsDailyWireCap: 0 });
  await test.pool.query("UPDATE candidates SET stage='api_validation',blocked_reason=NULL WHERE id=$1",[passing.candidateId]);
  assert.equal((await test.call(`/api/candidates/${passing.candidateId}`)).body.validation.status,"stale");
  const cachedContext={...passing,settingsVersion:cacheOnlySettings.version,snapshot:cacheOnlySettings.snapshot};
  assert.equal(await consumeOfficialValidation(test.pool,denyTransport(),cachedContext),"pass","Fresh retained data can be reassessed without a connection or new-call budget");
  assert.equal(requests.filter(item=>item.keyword===passing.keyword).length,2,"Cached reassessment must add no wire calls");

  const missing = await candidate("missing", await settings());
  const missingMetric = product(10);
  delete missingMetric.attributes.reviews;
  delete missingMetric.attributes.variants;
  scenarios.set(missing.keyword, { pages: new Map([["first", fixture([missingMetric], null)]]) });
  assert.equal(await consumeOfficialValidation(test.pool, transport, missing), "hold");
  assert.equal((await test.pool.query("SELECT blocked_reason FROM candidates WHERE id=$1", [missing.candidateId])).rows[0].blocked_reason, "evidence");
  const missingEvaluation = (await test.pool.query("SELECT payload FROM evaluations WHERE candidate_id=$1 AND kind='api_validation' ORDER BY created_at DESC LIMIT 1", [missing.candidateId])).rows[0];
  assert.equal(missingEvaluation.payload.evidenceBlock, "PRODUCT_DATABASE_METRICS_INCOMPLETE");
  assert.equal(missingEvaluation.payload.input.review700Count.kind, "unknown");
  assert.equal(missingEvaluation.payload.input.review700Count.value, null);
  const missingView=(await test.call('/api/candidates/'+missing.candidateId)).body;
  for(const field of ['api_catalog_reviews:B0AA000010','api_catalog_reported_variants:B0AA000010']){
    const observation=missingView.evidence.find(row=>row.field===field);
    assert.equal(observation?.kind,'unknown');assert.equal(observation.value_numeric,null,'Missing observations must not become zero');
  }
  const missingSource = (await test.pool.query("SELECT id FROM api_validation_sources WHERE candidate_id=$1 AND endpoint='product_database_query'", [missing.candidateId])).rows[0];
  assert.ok(missingSource);
  assert.equal(Number((await test.pool.query("SELECT count(*)::int AS count FROM api_validation_sources WHERE candidate_id=$1 AND endpoint='product_database_query'", [missing.candidateId])).rows[0].count), 1);
  assert.equal(await consumeOfficialValidation(test.pool, transport, missing), "hold");
  assert.equal(Number((await test.pool.query("SELECT count(*)::int AS count FROM api_validation_sources WHERE candidate_id=$1 AND endpoint='product_database_query'", [missing.candidateId])).rows[0].count), 1);
  await assert.rejects(test.pool.query("UPDATE api_validation_sources SET observed_at=now() WHERE id=$1", [missingSource.id]), /append-only/);

  const hardFail = await candidate("hard-fail", await settings({ productDatabaseMaxPages: 1 }));
  scenarios.set(hardFail.keyword, { pages: new Map([["first", fixture([product(20, { reviews: 2100 }), product(21, { reviews: 2500 })], officialNext("not-collected"))]]) });
  assert.equal(await consumeOfficialValidation(test.pool, transport, hardFail), "reject");
  assert.equal((await test.pool.query("SELECT stage FROM candidates WHERE id=$1", [hardFail.candidateId])).rows[0].stage, "rejected");

  const repeated = await candidate("repeated", await settings({ productDatabaseMaxPages: 3 }));
  scenarios.set(repeated.keyword, { pages: new Map([
    ["first", fixture([product(30)], officialNext("again"))],
    ["again", fixture([product(31)], officialNext("again"))],
  ]) });
  assert.equal(await consumeOfficialValidation(test.pool, transport, repeated), "hold");
  const repeatedEvaluation = (await test.pool.query("SELECT payload FROM evaluations WHERE candidate_id=$1 AND kind='api_validation'", [repeated.candidateId])).rows[0];
  assert.equal(repeatedEvaluation.payload.evidenceBlock, "REPEATED_OR_MISSING_CURSOR");

  const capped = await candidate("capped", await settings({ productDatabaseMaxPages: 1 }));
  scenarios.set(capped.keyword, { pages: new Map([["first", fixture([product(40)], officialNext("beyond-cap"))]]) });
  assert.equal(await consumeOfficialValidation(test.pool, transport, capped), "hold");
  assert.equal(requests.filter((item) => item.keyword === capped.keyword).length, 1);

  const staleSettings = await settings();
  const stale = await candidate("stale", staleSettings);
  scenarios.set(stale.keyword, { pages: new Map([["first", fixture([product(50)], null)]]), bumpSettings: true, bumped: false });
  assert.equal(await consumeOfficialValidation(test.pool, transport, stale), "stale");
  assert.equal((await test.pool.query("SELECT stage,blocked_reason FROM candidates WHERE id=$1", [stale.candidateId])).rows[0].stage, "api_validation");
  assert.equal(Number((await test.pool.query("SELECT count(*)::int AS count FROM evaluations WHERE candidate_id=$1", [stale.candidateId])).rows[0].count), 0);
  assert.equal(Number((await test.pool.query("SELECT count(*)::int AS count FROM api_validation_sources WHERE candidate_id=$1 AND settings_version=$2", [stale.candidateId, stale.settingsVersion])).rows[0].count), 1);

  const racingSettings = await settings();
  const racing = await candidate("settings-race", racingSettings);
  await manualNicheEvidence(racing.candidateId);
  scenarios.set(racing.keyword, { pages: new Map([["first", fixture([product(60)], null)]]) });
  const settingsLock = await test.pool.connect();
  let settingsLockOpen = true;
  try {
    await settingsLock.query("BEGIN");
    await settingsLock.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const raced = consumeOfficialValidation(test.pool, transport, racing);
    settingsVersion += 1;
    await settingsLock.query(
      "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'api-validation-race',$2::jsonb)",
      [settingsVersion, JSON.stringify(racing.snapshot)],
    );
    await settingsLock.query("COMMIT");
    settingsLockOpen = false;
    assert.equal(await raced, "stale");
  } finally {
    if (settingsLockOpen) await settingsLock.query("ROLLBACK");
    settingsLock.release();
  }
  assert.equal((await test.pool.query("SELECT stage,blocked_reason FROM candidates WHERE id=$1", [racing.candidateId])).rows[0].stage, "api_validation");
  assert.equal(Number((await test.pool.query("SELECT count(*)::int AS count FROM evaluations WHERE candidate_id=$1", [racing.candidateId])).rows[0].count), 0);

  const budget = await candidate("budget", await settings({ jsDailyWireCap: 0 }));
  assert.equal(await consumeOfficialValidation(test.pool, transport, budget), "blocked");
  assert.equal((await test.pool.query("SELECT blocked_reason FROM candidates WHERE id=$1", [budget.candidateId])).rows[0].blocked_reason, "budget");

  const credential = await candidate("credential", await settings());
  assert.equal(await consumeOfficialValidation(test.pool, denyTransport(), credential), "blocked");
  assert.equal((await test.pool.query("SELECT blocked_reason FROM candidates WHERE id=$1", [credential.candidateId])).rows[0].blocked_reason, "credential");

  const unknown = await candidate("unknown", await settings());
  scenarios.set(unknown.keyword, { pages: new Map(), dropConnection: true });
  assert.equal(await consumeOfficialValidation(test.pool, transport, unknown), "blocked");
  assert.equal((await test.pool.query("SELECT blocked_reason FROM candidates WHERE id=$1", [unknown.candidateId])).rows[0].blocked_reason, "external_outcome_unknown");

  for(const category of ['Home & Kitchen','Office Products',null]){
    const unconfirmed=await candidate('category-'+String(category),await settings());
    await manualNicheEvidence(unconfirmed.candidateId);
    scenarios.set(unconfirmed.keyword,{pages:new Map([['first',fixture(Array.from({length:6},(_,index)=>product(200+index,{category})),null)]])});
    assert.equal(await consumeOfficialValidation(test.pool,transport,unconfirmed),'hold','Unconfirmed Kitchen & Dining membership cannot progress to sourcing');
    const held=(await test.pool.query('SELECT outcome,payload FROM evaluations WHERE candidate_id=$1',[unconfirmed.candidateId])).rows[0];
    assert.equal(held.payload.evidenceBlock,'CATEGORY_MEMBERSHIP_UNCONFIRMED');
    assert.equal((await test.pool.query('SELECT stage FROM candidates WHERE id=$1',[unconfirmed.candidateId])).rows[0].stage,'api_validation');
  }
  console.log(JSON.stringify({
    scenario: "api-validation",
    result: "PASS",
    database: test.database,
    cacheOnlyReassessment: true,
    pagination: { bodyPreserved: true, cursorPreserved: true, maxCapHeld: true, repeatedCursorHeld: true },
    outcomes: { completePass: "sourcing", missingMetrics: "evidence", partialReviewHardFail: "rejected", staleCallback: "unchanged", settingsRace: "stale", budget: "budget", credential: "credential", outcomeUnknown: "external_outcome_unknown" },
    rawEvidence: { appendOnlyRowsRetained: true, duplicateResponseRows: 1, payloadLogged: false },
    migrationLedger: "0008_api_evidence.sql",
  }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await test.close();
}
