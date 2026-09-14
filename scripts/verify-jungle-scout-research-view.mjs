import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { openAcceptance } from './support/acceptance.mjs';
import { browserSigningFixture } from './support/browser-signing-fixture.mjs';
import { publishBrowserSigningIdentity } from '../apps/worker/src/browser-signing-key.ts';
import {
  queueCategoryTrends,
  queueCompetitiveIntelligence,
  queueHistoricalData,
  queueKeywordScout,
  queueProductDatabase,
} from '../apps/worker/src/browser-task-producer.ts';

const reserve = createServer();
reserve.listen(0, '127.0.0.1');
await once(reserve, 'listening');
const address = reserve.address();
assert.ok(address && typeof address === 'object');
await new Promise(resolve => reserve.close(resolve));

const origin = 'http://127.0.0.1:' + address.port;
const test = await openAcceptance({ databaseKey: 'jungle-scout-research-view-' + Date.now(), webOrigin: origin });
try {
  await test.app.listen({ host: '127.0.0.1', port: address.port });
  const keys = browserSigningFixture();
  const identity = await publishBrowserSigningIdentity(test.pool, keys.privateKey);
  const pairing = await test.call('/api/bridge/pairings', {});
  const enrolled = await test.call('/api/bridge/pair', { pairingCode: pairing.body.pairingCode, name: 'Synthetic Jungle Scout observer' });
  assert.equal(enrolled.status, 201);
  const deviceId = enrolled.body.id;
  const bridge = async (path, body) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, authorization: 'Bearer ' + enrolled.body.credential, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await bridge('/api/bridge/capabilities', { connected: true, supportedTasks: ['product_database', 'keyword_scout', 'historical_data', 'category_trends', 'competitive_intelligence'], keyFingerprint: identity.fingerprint })).status, 200);
  const query = 'synthetic jungle scout evidence ' + test.runId;
  const candidate = (await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id", [query])).rows[0];
  const emptyCandidate = (await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id", [query + ' empty'])).rows[0];
  const empty = await test.call('/api/candidates/' + emptyCandidate.id + '/jungle-scout-research');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.research.every(item => item.state === 'not_collected'), true, 'Absent browser tasks remain explicitly uncollected');
  const queues = [queueProductDatabase, queueKeywordScout, queueHistoricalData, queueCategoryTrends, queueCompetitiveIntelligence];
  const observations = {
    product_database: { protocol: 1, kind: 'captured', scope: 'jungle_scout_product_database', query, sourcePageUrl: 'https://members.junglescout.com/#/database', observedAt: new Date().toISOString(), snapshot: 'SECRET_SNAPSHOT_PRODUCT', records: [{ asin: 'B0JV000001', title: 'Synthetic product', sourceText: 'B0JV000001 Synthetic product' }] },
    keyword_scout: { protocol: 1, kind: 'captured', scope: 'jungle_scout_keyword_scout', query, sourcePageUrl: 'https://members.junglescout.com/#/keyword', observedAt: new Date().toISOString(), snapshot: 'SECRET_SNAPSHOT_KEYWORD', metrics: [{ label: 'Search Volume', value: '2,400', sourceText: 'Search Volume 2,400' }], relatedKeywords: [{ keyword: 'synthetic related keyword', sourceText: 'synthetic related keyword' }], asinRelations: [{ asin: 'B0JV000001', sourceText: 'B0JV000001' }] },
    historical_data: { protocol: 1, kind: 'captured', scope: 'jungle_scout_historical_data', query, sourcePageUrl: 'https://members.junglescout.com/historical-data', observedAt: new Date().toISOString(), snapshot: 'SECRET_SNAPSHOT_HISTORY', dateRange: { label: 'Jan 2026', start: '2026-01-01T00:00:00.000Z', end: '2026-01-31T00:00:00.000Z' }, series: [{ metric: 'Search Volume', periodLabel: 'Jan 2026', value: '2,400', sourceText: 'Search Volume Jan 2026 2,400' }] },
    category_trends: { protocol: 1, kind: 'captured', scope: 'jungle_scout_category_trends', query, sourcePageUrl: 'https://members.junglescout.com/category-trends', observedAt: new Date().toISOString(), snapshot: 'SECRET_SNAPSHOT_CATEGORY', categories: [{ category: 'Kitchen & Dining', sourceText: 'Kitchen & Dining' }], kitchenDiningConfirmation: 'confirmed', signals: [{ label: 'Growth', value: '12%', sourceText: 'Growth 12%' }] },
    competitive_intelligence: { protocol: 1, kind: 'captured', scope: 'jungle_scout_competitive_intelligence', query, sourcePageUrl: 'https://members.junglescout.com/#/competitive-intelligence', observedAt: new Date().toISOString(), snapshot: 'SECRET_SNAPSHOT_COMPETITIVE', representativeAsin: 'B0JV000001', competitors: [{ asin: 'B0JV000001', brand: 'Synthetic Brand', price: '$25.00', reviews: '120', sales: null, revenue: null, sourceText: 'B0JV000001 Synthetic Brand $25.00 120' }] },
  };
  for (let index = 0; index < queues.length; index += 1) {
    const queue = queues[index];
    const queued = await queue(test.pool, { deviceId, candidateId: candidate.id }, { origin, privateKey: keys.privateKey });
    assert.equal(queued.kind, 'queued');
    const claim = await bridge('/api/bridge/tasks/claim', {});
    assert.equal(claim.body.kind, 'task');
    const kind = JSON.parse(Buffer.from(claim.body.envelope.payload, 'base64url').toString('utf8')).request.kind;
    assert.equal(kind, ['product_database', 'keyword_scout', 'historical_data', 'category_trends', 'competitive_intelligence'][index]);
    const observation = { ...observations[kind], observedAt: new Date().toISOString() };
    const accepted = await bridge('/api/bridge/tasks/' + claim.body.taskId + '/results', { taskHash: claim.body.taskHash, observation });
    assert.equal(accepted.status, 201);
  }
  const view = await test.call('/api/candidates/' + candidate.id + '/jungle-scout-research');
  assert.equal(view.status, 200);
  assert.equal(view.body.research.length, 5);
  assert.deepEqual(view.body.research.map(item => item.kind).sort(), ['category_trends', 'competitive_intelligence', 'historical_data', 'keyword_scout', 'product_database']);
  assert.ok(view.body.research.every(item => item.state === 'captured' && item.sourcePageUrl.startsWith('https://members.junglescout.com/') && typeof item.observedAt === 'string'));
  assert.equal(view.body.research.find(item => item.kind === 'category_trends').result.kitchenDiningConfirmation, 'confirmed');
  assert.equal(JSON.stringify(view.body).includes('SECRET_SNAPSHOT'), false, 'Raw encrypted browser snapshots must never be returned to the browser');
  await test.pool.query('UPDATE candidates SET input_version=input_version+1 WHERE id=$1', [candidate.id]);
  const stale = await test.call('/api/candidates/' + candidate.id + '/jungle-scout-research');
  assert.equal(stale.body.research.every(item => item.state === 'stale'), true, 'Prior encrypted observations are not shown as current evidence after input changes');
  console.log(JSON.stringify({ scenario: 'jungle_scout_candidate_research_view', result: 'PASS', taskStatuses: true, capturedResults: true, provenance: true, rawSnapshotWithheld: true, uncollectedExplicit: true, staleWithheld: true }));
} finally {
  await test.close();
}
