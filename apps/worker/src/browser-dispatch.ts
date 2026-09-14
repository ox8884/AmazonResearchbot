import type { KeyObject } from "node:crypto";
import type { Pool } from "@forge-ops/db";
import { supplierCompanyUrlPattern, supplierProductUrlPattern } from "@forge-ops/domain";
import { queueSupplierSearch, queueSupplierDetail, queueAmazonPackage,queueAmazonSearch,queueProductDatabase,queueKeywordScout,queueHistoricalData,queueCategoryTrends,queueCompetitiveIntelligence } from "./browser-task-producer.ts";
import {dispatchSearchExports} from './search-export-producer.ts';

const jungleScoutBrowserTaskKinds = [
  'saved_search_export',
  'product_database',
  'keyword_scout',
  'historical_data',
  'category_trends',
  'competitive_intelligence',
] as const;

async function readJungleScoutBrowserBudget(pool: Pool): Promise<number> {
  const setting = (await pool.query<{ cap: number | null }>(
    "SELECT (snapshot->>'jsDailyWireCap')::int AS cap FROM settings_versions ORDER BY version DESC LIMIT 1",
  )).rows[0];
  const cap = setting?.cap ?? 0;
  if (!Number.isSafeInteger(cap) || cap <= 0) return 0;
  const used = (await pool.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM browser_tasks
     WHERE task_kind=ANY($1::text[]) AND (state='completed' OR (state IN ('queued','delivered') AND expires_at>clock_timestamp()))
       AND created_at>=date_trunc('day',clock_timestamp())`,
    [jungleScoutBrowserTaskKinds],
  )).rows[0]?.used ?? 0;
  return Math.max(0, cap - used);
}

export async function dispatchBrowserWork(pool: Pool, signing: { readonly origin: string; readonly privateKey: KeyObject; readonly fingerprint: string }) {
  let researchRemaining = await readJungleScoutBrowserBudget(pool);
  const searches=researchRemaining > 0
    ? await dispatchSearchExports(pool,signing,researchRemaining)
    : {queued:0,deviceReady:false};
  const devices = (await pool.query<{ id: string; capability: "supplier_search" | "supplier_detail" | "amazon_package" | "amazon_search" | "product_database" | "keyword_scout" | "historical_data" | "category_trends" | "competitive_intelligence" }>(`
    SELECT DISTINCT ON (caps.capability) d.id,caps.capability FROM bridge_devices d JOIN "user" u ON u.id=d.owner_user_id
    CROSS JOIN LATERAL unnest(d.reported_tasks) caps(capability)
    WHERE d.revoked_at IS NULL AND u.two_factor_enabled=true AND d.reported_connected=true
      AND d.reported_at>clock_timestamp()-interval '90 seconds' AND d.reported_key_fingerprint=$1
      AND caps.capability IN ('supplier_search','supplier_detail','amazon_package','amazon_search','product_database','keyword_scout','historical_data','category_trends','competitive_intelligence')
    ORDER BY caps.capability,d.reported_at DESC,d.id`, [signing.fingerprint])).rows;
  if (!devices.length) return searches;
  let queued = searches.queued;
  researchRemaining -= searches.queued;
  const marketDevice=devices.find(device=>device.capability==='amazon_search');
  if(marketDevice){
    const candidates=(await pool.query<{id:string}>(`
      SELECT c.id FROM candidates c JOIN LATERAL(SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      WHERE c.marketplace='us' AND c.stage='api_validation' AND length(c.normalized_keyword) BETWEEN 1 AND 500
       AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.task_kind='amazon_search'
        AND t.input_version=c.input_version AND t.settings_version=v.version
        AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT 20`)).rows;
    for(const candidate of candidates)if((await queueAmazonSearch(pool,{deviceId:marketDevice.id,candidateId:candidate.id},signing)).kind==='queued')queued++;
  }
  const productDatabaseDevice=devices.find(device=>device.capability==='product_database');
  if(productDatabaseDevice && researchRemaining > 0){
    const candidates=(await pool.query<{id:string}>(`
      SELECT c.id FROM candidates c JOIN LATERAL(SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      WHERE c.marketplace='us' AND c.stage='api_validation' AND length(c.normalized_keyword) BETWEEN 1 AND 500
       AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.task_kind='product_database'
        AND t.input_version=c.input_version AND t.settings_version=v.version
        AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT $1`,[Math.min(20,researchRemaining)])).rows;
    for(const candidate of candidates)if((await queueProductDatabase(pool,{deviceId:productDatabaseDevice.id,candidateId:candidate.id},signing)).kind==='queued'){queued++;researchRemaining--;}
  }
  const keywordScoutDevice=devices.find(device=>device.capability==='keyword_scout');
  if(keywordScoutDevice && researchRemaining > 0){
    const candidates=(await pool.query<{id:string}>(`
      SELECT c.id FROM candidates c JOIN LATERAL(SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      WHERE c.marketplace='us' AND c.stage='api_validation' AND length(c.normalized_keyword) BETWEEN 1 AND 500
       AND EXISTS(SELECT 1 FROM browser_tasks prerequisite WHERE prerequisite.candidate_id=c.id AND prerequisite.task_kind='product_database'
        AND prerequisite.input_version=c.input_version AND prerequisite.settings_version=v.version AND prerequisite.state='completed')
       AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.task_kind='keyword_scout'
        AND t.input_version=c.input_version AND t.settings_version=v.version
        AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT $1`,[Math.min(20,researchRemaining)])).rows;
    for(const candidate of candidates)if((await queueKeywordScout(pool,{deviceId:keywordScoutDevice.id,candidateId:candidate.id},signing)).kind==='queued'){queued++;researchRemaining--;}
  }
  const historicalDataDevice=devices.find(device=>device.capability==='historical_data');
  if(historicalDataDevice && researchRemaining > 0){
    const candidates=(await pool.query<{id:string}>(`
      SELECT c.id FROM candidates c JOIN LATERAL(SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      WHERE c.marketplace='us' AND c.stage='api_validation' AND length(c.normalized_keyword) BETWEEN 1 AND 500
       AND EXISTS(SELECT 1 FROM browser_tasks prerequisite WHERE prerequisite.candidate_id=c.id AND prerequisite.task_kind='keyword_scout'
        AND prerequisite.input_version=c.input_version AND prerequisite.settings_version=v.version AND prerequisite.state='completed')
       AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.task_kind='historical_data'
        AND t.input_version=c.input_version AND t.settings_version=v.version
        AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT $1`,[Math.min(20,researchRemaining)])).rows;
    for(const candidate of candidates)if((await queueHistoricalData(pool,{deviceId:historicalDataDevice.id,candidateId:candidate.id},signing)).kind==='queued'){queued++;researchRemaining--;}
  }
  const categoryTrendsDevice=devices.find(device=>device.capability==='category_trends');
  if(categoryTrendsDevice && researchRemaining > 0){
    const candidates=(await pool.query<{id:string}>(`
      SELECT c.id FROM candidates c JOIN LATERAL(SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      WHERE c.marketplace='us' AND c.stage='api_validation' AND length(c.normalized_keyword) BETWEEN 1 AND 500
       AND EXISTS(SELECT 1 FROM browser_tasks prerequisite WHERE prerequisite.candidate_id=c.id AND prerequisite.task_kind='historical_data'
        AND prerequisite.input_version=c.input_version AND prerequisite.settings_version=v.version AND prerequisite.state='completed')
       AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.task_kind='category_trends'
        AND t.input_version=c.input_version AND t.settings_version=v.version
        AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT $1`,[Math.min(20,researchRemaining)])).rows;
    for(const candidate of candidates)if((await queueCategoryTrends(pool,{deviceId:categoryTrendsDevice.id,candidateId:candidate.id},signing)).kind==='queued'){queued++;researchRemaining--;}
  }
  const competitiveIntelligenceDevice=devices.find(device=>device.capability==='competitive_intelligence');
  if(competitiveIntelligenceDevice && researchRemaining > 0){
    const candidates=(await pool.query<{id:string}>(`
      SELECT c.id FROM candidates c JOIN LATERAL(SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      WHERE c.marketplace='us' AND c.stage='api_validation' AND length(c.normalized_keyword) BETWEEN 1 AND 500
       AND EXISTS(SELECT 1 FROM browser_tasks prerequisite WHERE prerequisite.candidate_id=c.id AND prerequisite.task_kind='category_trends'
        AND prerequisite.input_version=c.input_version AND prerequisite.settings_version=v.version AND prerequisite.state='completed')
       AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.task_kind='competitive_intelligence'
        AND t.input_version=c.input_version AND t.settings_version=v.version
        AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT $1`,[Math.min(20,researchRemaining)])).rows;
    for(const candidate of candidates)if((await queueCompetitiveIntelligence(pool,{deviceId:competitiveIntelligenceDevice.id,candidateId:candidate.id},signing)).kind==='queued'){queued++;researchRemaining--;}
  }
  const packageDevice = devices.find(device => device.capability === 'amazon_package');
  if (packageDevice) {
    const candidates = (await pool.query<{id:string}>(`
      SELECT c.id FROM candidates c
      JOIN LATERAL (SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      JOIN candidate_events e ON e.candidate_id=c.id AND e.input_version=c.input_version AND e.stage='api_validation'
      WHERE c.marketplace='us' AND c.stage='api_validation' AND e.detail->>'representativeAsin' ~ '^[A-Z0-9]{10}$'
        AND EXISTS(SELECT 1 FROM browser_tasks prerequisite WHERE prerequisite.candidate_id=c.id AND prerequisite.task_kind='competitive_intelligence'
          AND prerequisite.input_version=c.input_version AND prerequisite.settings_version=v.version AND prerequisite.state='completed')
        AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.spec_id IS NULL AND t.task_kind='amazon_package'
          AND t.input_version=c.input_version AND t.settings_version=v.version
          AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT 20`)).rows;
    for (const candidate of candidates) {
      if ((await queueAmazonPackage(pool,{deviceId:packageDevice.id,candidateId:candidate.id},signing)).kind === 'queued') queued++;
    }
  }
  const searchDevice = devices.find(device => device.capability === "supplier_search");
  if (searchDevice) {
    const candidates = (await pool.query<{ id: string }>(`
      SELECT c.id FROM candidates c
      JOIN LATERAL (SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      JOIN LATERAL (SELECT id FROM spec_revisions WHERE candidate_id=c.id ORDER BY revision DESC LIMIT 1) s ON true
      JOIN LATERAL (SELECT outcome,stale FROM evaluations WHERE candidate_id=c.id AND kind='api_validation'
        AND settings_version=v.version AND payload->>'inputVersion'=c.input_version::text
        ORDER BY created_at DESC,id DESC LIMIT 1) e ON e.outcome='pass' AND NOT e.stale
      WHERE c.stage IN ('sourcing','rfq_draft','awaiting_contact_approval')
        AND (c.blocked_reason IS NULL OR c.blocked_reason='web_session')
        AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.candidate_id=c.id AND t.spec_id=s.id
          AND t.input_version=c.input_version AND t.settings_version=v.version AND t.source_capture_id IS NULL
          AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT 20`)).rows;
    for (const candidate of candidates) {
      if ((await queueSupplierSearch(pool, { deviceId: searchDevice.id, candidateId: candidate.id }, signing)).kind === "queued") queued++;
    }
  }
  const detailDevice = devices.find(device => device.capability === "supplier_detail");
  if (detailDevice) {
    const captures = (await pool.query<{ candidate_id: string; id: string }>(`
      SELECT cap.id,cap.candidate_id FROM supplier_captures cap JOIN candidates c ON c.id=cap.candidate_id
      JOIN LATERAL (SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
      JOIN LATERAL (SELECT id FROM spec_revisions WHERE candidate_id=c.id ORDER BY revision DESC LIMIT 1) s ON s.id=cap.spec_id
      JOIN LATERAL (SELECT outcome,stale FROM evaluations WHERE candidate_id=c.id AND kind='api_validation'
        AND settings_version=v.version AND payload->>'inputVersion'=c.input_version::text
        ORDER BY created_at DESC,id DESC LIMIT 1) e ON e.outcome='pass' AND NOT e.stale
      WHERE cap.capture_method='aside_search_result' AND cap.input_version=c.input_version AND cap.settings_version=v.version
        AND c.stage IN ('sourcing','rfq_draft','awaiting_contact_approval')
        AND (c.blocked_reason IS NULL OR c.blocked_reason='web_session')
        AND cap.company_url ~ $1 AND cap.product_url ~ $2
        AND NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.source_capture_id=cap.id
          AND (t.state='completed' OR (t.state IN ('queued','delivered') AND t.expires_at>clock_timestamp())))
      ORDER BY c.last_progress_at,c.id,cap.created_at,cap.id LIMIT 20`, [supplierCompanyUrlPattern.source, supplierProductUrlPattern.source])).rows;
    for (const capture of captures) {
      if ((await queueSupplierDetail(pool, { deviceId: detailDevice.id, candidateId: capture.candidate_id, sourceCaptureId: capture.id }, signing)).kind === "queued") queued++;
    }
  }
  return { queued, deviceReady: true };
}
