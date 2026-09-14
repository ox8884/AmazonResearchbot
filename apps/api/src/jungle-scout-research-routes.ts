import type { FastifyInstance } from 'fastify';
import type { Pool } from '@forge-ops/db';
import { browserObservationSchema } from '@forge-ops/domain';
import { decryptSecret, exactPayloadHash } from '@forge-ops/security';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.uuid() });
const retryParamsSchema = z.object({ id: z.uuid(), kind: z.enum(['product_database', 'keyword_scout', 'historical_data', 'category_trends', 'competitive_intelligence']) });
const taskKinds = ['product_database', 'keyword_scout', 'historical_data', 'category_trends', 'competitive_intelligence'] as const;
const taskKindSchema = z.enum(taskKinds);
type JungleScoutTaskKind = z.infer<typeof taskKindSchema>;
type TaskRow = {
  readonly task_kind: string;
  readonly state: 'queued' | 'delivered' | 'completed' | 'cancelled';
  readonly input_version: number;
  readonly settings_version: number;
  readonly current_input: number;
  readonly current_settings: number | null;
  readonly query: string;
  readonly expires_at: Date;
  readonly receipt_id: string | null;
  readonly body_ciphertext: string | null;
  readonly body_sha256: string | null;
};

type ResearchState = 'not_collected' | 'stale' | 'waiting' | 'collecting' | 'unavailable';
type Provenance = { readonly source: 'jungle_scout_web'; readonly receiptId: string; readonly resultHash: string };
type CapturedResearch = {
  readonly state: 'captured';
  readonly kind: JungleScoutTaskKind;
  readonly sourcePageUrl: string;
  readonly observedAt: string;
  readonly provenance: Provenance;
  readonly result: Record<string, unknown>;
};
type ResearchView = { readonly state: ResearchState; readonly kind: JungleScoutTaskKind; readonly reason?: string } | CapturedResearch;

function stateFor(row: TaskRow): ResearchState {
  if (row.input_version !== row.current_input || row.settings_version !== row.current_settings) return 'stale';
  if (row.state === 'completed') return 'unavailable';
  return row.state === 'cancelled' || row.expires_at.getTime() <= Date.now() ? 'waiting' : 'collecting';
}

function pendingReason(row: TaskRow, state: ResearchState): string | undefined {
  if (state === 'stale') return 'INPUT_OR_SETTINGS_CHANGED';
  if (state === 'waiting') return 'BROWSER_TASK_EXPIRED';
  if (state === 'unavailable' && (!row.receipt_id || !row.body_ciphertext || !row.body_sha256)) return 'RESULT_RECEIPT_MISSING';
  return undefined;
}

function projectResult(kind: JungleScoutTaskKind, raw: unknown, query: string): Omit<CapturedResearch, 'kind' | 'provenance'> | null {
  const parsed = browserObservationSchema.safeParse(raw);
  if (!parsed.success || !('query' in parsed.data) || parsed.data.query !== query) return null;
  const observation = parsed.data;
  switch (kind) {
    case 'product_database':
      if (observation.scope !== 'jungle_scout_product_database') return null;
      return { state: 'captured', sourcePageUrl: observation.sourcePageUrl, observedAt: observation.observedAt, result: { displayedCount: observation.displayedCount ?? null, totalCount: observation.totalCount ?? null, coverage: observation.coverage ?? null, records: observation.records.map(({ asin, title, brand = null, categoryPath = null, bsr = null, unitsSoldMonthly = null, revenueMonthly = null, price = null, reviews = null, starRating = null, sellers = null, dimensions = null, weight = null }) => ({ asin, title, brand, categoryPath, bsr, unitsSoldMonthly, revenueMonthly, price, reviews, starRating, sellers, dimensions, weight })) } };
    case 'keyword_scout':
      if (observation.scope !== 'jungle_scout_keyword_scout') return null;
      return { state: 'captured', sourcePageUrl: observation.sourcePageUrl, observedAt: observation.observedAt, result: {
        metrics: observation.metrics.map(({ label, value }) => ({ label, value })),
        keywordRecords: (observation.keywordRecords ?? []).map(({ keyword, searchTrend30Day = null, exactSearchVolume30Day = null, category = null, ppcBidExact = null, ppcBidBroad = null, easeToRank = null, relevancyScore = null }) => ({ keyword, searchTrend30Day, exactSearchVolume30Day, category, ppcBidExact, ppcBidBroad, easeToRank, relevancyScore })),
        relatedKeywords: observation.relatedKeywords.map(({ keyword }) => keyword),
        asinRelations: observation.asinRelations.map(({ asin }) => asin),
      } };
    case 'historical_data':
      if (observation.scope !== 'jungle_scout_historical_data') return null;
      return { state: 'captured', sourcePageUrl: observation.sourcePageUrl, observedAt: observation.observedAt, result: {
        dateRange: observation.dateRange,
        representativeAsin: observation.representativeAsin ?? null,
        unavailableMetrics: observation.unavailableMetrics ?? [],
        series: observation.series.map(({ metric, periodLabel, value }) => ({ metric, periodLabel, value })),
      } };
    case 'category_trends':
      if (observation.scope !== 'jungle_scout_category_trends') return null;
      return { state: 'captured', sourcePageUrl: observation.sourcePageUrl, observedAt: observation.observedAt, result: {
        categories: observation.categories.map(({ category }) => category),
        kitchenDiningConfirmation: observation.kitchenDiningConfirmation,
        signals: observation.signals.map(({ label, value }) => ({ label, value })),
        representativeAsin: observation.representativeAsin ?? null,
        unavailableSignals: observation.unavailableSignals ?? [],
        products: (observation.products ?? []).map(({ asin, rank = null, productName = null, rating = null, reviews = null, price = null, dateLabel = null }) => ({ asin, rank, productName, rating, reviews, price, dateLabel })),
        dateColumns: (observation.dateColumns ?? []).map(({ dateLabel, products }) => ({ dateLabel, productCount: products.length })),
        representativeHistory: (observation.representativeHistory ?? []).map(({ asin, rank = null, productName = null, rating = null, reviews = null, price = null, dateLabel = null }) => ({ asin, rank, productName, rating, reviews, price, dateLabel })),
      } };
    case 'competitive_intelligence':
      if (observation.scope !== 'jungle_scout_competitive_intelligence') return null;
      return { state: 'captured', sourcePageUrl: observation.sourcePageUrl, observedAt: observation.observedAt, result: {
        representativeAsin: observation.representativeAsin,
        representativeSelection: observation.representativeSelection ?? null,
        comparisonBasis: observation.comparisonBasis ?? 'competitive_intelligence',
        displayedCount: observation.displayedCount ?? null,
        totalCount: observation.totalCount ?? null,
        coverage: observation.coverage ?? null,
        entitlement: observation.entitlement ? {
          status: observation.entitlement.status,
          currentPlan: observation.entitlement.currentPlan,
          requiredPlan: observation.entitlement.requiredPlan,
          sourcePageUrl: observation.entitlement.sourcePageUrl,
        } : null,
        competitors: observation.competitors.map(({ asin, brand, price, reviews, sales, revenue }) => ({ asin, brand, price, reviews, sales, revenue })),
      } };
  }
}

async function readResearch(pool: Pool, candidateId: string, key: Buffer): Promise<readonly ResearchView[]> {
  const rows = await pool.query<TaskRow>(`
    SELECT DISTINCT ON(t.task_kind)
      t.task_kind,t.state,t.input_version,t.settings_version,c.input_version AS current_input,
      (SELECT max(version) FROM settings_versions) AS current_settings,c.normalized_keyword AS query,
      t.expires_at,r.id AS receipt_id,r.body_ciphertext,r.body_sha256
    FROM candidates c
    LEFT JOIN browser_tasks t ON t.candidate_id=c.id AND t.task_kind=ANY($2::text[])
    LEFT JOIN browser_task_results r ON r.id=t.result_id AND r.task_id=t.id
    WHERE c.id=$1
    ORDER BY t.task_kind,t.created_at DESC,t.id DESC`, [candidateId, taskKinds]);
  const byKind = new Map<JungleScoutTaskKind, TaskRow>();
  for (const row of rows.rows) {
    const kind = taskKindSchema.safeParse(row.task_kind);
    if (kind.success) byKind.set(kind.data, row);
  }
  return taskKinds.map(kind => {
    const row = byKind.get(kind);
    if (!row) return { kind, state: 'not_collected' };
    const state = stateFor(row);
    if (state !== 'unavailable') return { kind, state, ...(pendingReason(row, state) ? { reason: pendingReason(row, state) } : {}) };
    if (!row.receipt_id || !row.body_ciphertext || !row.body_sha256) return { kind, state, reason: 'RESULT_RECEIPT_MISSING' };
    try {
      const raw: unknown = JSON.parse(decryptSecret(row.body_ciphertext, key, 'browser-task-result:' + row.receipt_id).toString('utf8'));
      if (exactPayloadHash(raw) !== row.body_sha256) return { kind, state, reason: 'RESULT_HASH_MISMATCH' };
      const result = projectResult(kind, raw, row.query);
      return result === null ? { kind, state, reason: 'OBSERVATION_INVALID' } : { kind, provenance: { source: 'jungle_scout_web', receiptId: row.receipt_id, resultHash: row.body_sha256 }, ...result };
    } catch {
      return { kind, state, reason: 'RESULT_DECRYPTION_FAILED' };
    }
  });
}

export function registerJungleScoutResearchRoutes(app: FastifyInstance, pool: Pool, key: Buffer) {
  app.get('/api/candidates/:id/jungle-scout-research', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: 'INVALID_CANDIDATE' });
    if (!(await pool.query('SELECT id FROM candidates WHERE id=$1', [params.data.id])).rowCount) return reply.status(404).send({ code: 'NOT_FOUND' });
    return { research: await readResearch(pool, params.data.id, key) };
  });
  app.post('/api/candidates/:id/jungle-scout-research/:kind/retry', async (request, reply) => {
    const params = retryParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: 'INVALID_RESEARCH_RETRY' });
    const actor = 'userId' in request && typeof request.userId === 'string' ? request.userId : null;
    if (!actor) return reply.status(401).send({ code: 'UNAUTHENTICATED' });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
      const context = (await db.query<{ cap: number; input_version: number; settings_version: number }>(`
        SELECT COALESCE((s.snapshot->>'jsDailyWireCap')::int,0) AS cap,c.input_version,s.version AS settings_version
        FROM candidates c CROSS JOIN LATERAL(SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1)s
        WHERE c.id=$1 FOR UPDATE OF c`, [params.data.id])).rows[0];
      if (!context) { await db.query('ROLLBACK'); return reply.status(404).send({ code: 'NOT_FOUND' }); }
      if (context.cap <= 0) { await db.query('ROLLBACK'); return reply.status(409).send({ code: 'JUNGLE_SCOUT_DAILY_LIMIT_DISABLED' }); }
      await db.query(`UPDATE browser_tasks SET state='cancelled'
        WHERE candidate_id=$1 AND task_kind=$2 AND input_version=$3 AND settings_version=$4
          AND state IN ('queued','delivered')`, [params.data.id, params.data.kind, context.input_version, context.settings_version]);
      await db.query("INSERT INTO audit_events(actor,action,target) VALUES($1,'jungle_scout_retry_requested',$2)", [actor, params.data.id + ':' + params.data.kind]);
      await db.query('COMMIT');
      return reply.status(202).send({ state: 'retry_requested', kind: params.data.kind });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  });
}
