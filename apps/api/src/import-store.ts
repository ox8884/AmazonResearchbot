import type {QueryConnection} from '@forge-ops/db';
import type {PgBoss} from 'pg-boss';
import {parseNumericCell,unknown,type Stage} from '@forge-ops/domain';
import {SYNTHETIC_SCHEMA,type ParseResult} from '@forge-ops/integrations/jungle-scout/csv';
import type { CsvMapping } from '@forge-ops/domain';
import {encryptSecret} from '@forge-ops/security';
import {JOB_ADVANCE,txAdapter,type AdvanceJob} from './queue.ts';
import { z } from 'zod';

export class ImportMappingConflict extends Error{constructor(){super('IMPORT_MAPPING_CONFLICT');}}
type CsvSource={kind:'manual';mapped:boolean}|{kind:'browser';observedAt:string};
export async function importCsvWithinTransaction(client:QueryConnection,input:{filename:string;bytes:Buffer;parsed:ParseResult;source:CsvSource},boss:PgBoss,encryptionKey:Buffer){
 const {filename,bytes,parsed,source:provenance}=input,marketplace='us';
 if(parsed.validCount===0||parsed.rows.some(row=>row.error!==null))throw new Error('INVALID_IMPORT_ROWS');
 const sourceType=provenance.kind==='browser'?'junglescout_web':!provenance.mapped&&parsed.rows[0]&&Object.hasOwn(parsed.rows[0].raw,'keyword')?SYNTHETIC_SCHEMA:'user_declared';
 const schemaVersion=provenance.kind==='browser'?'junglescout.opportunity-finder.web.v1':provenance.mapped?parsed.mappedSchema:SYNTHETIC_SCHEMA;
 const observedAt=provenance.kind==='browser'?provenance.observedAt:new Date().toISOString();
 const ciphertext=encryptSecret(bytes,encryptionKey,`import:${filename}:bytes`);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["import:"+marketplace+":"+parsed.sha256]);
      const prior = await client.query<{ id: string; mapping_matches:boolean }>("SELECT id,COALESCE(column_mapping,$4::jsonb)=$3::jsonb AS mapping_matches FROM imports WHERE sha256=$1 AND marketplace=$2", [parsed.sha256, marketplace,JSON.stringify(parsed.mapping),JSON.stringify(parsed.defaultMapping)]);
      if (prior.rows[0]) {
        if(!prior.rows[0].mapping_matches){
          const previous=(await client.query<{column_mapping:CsvMapping}>(`SELECT column_mapping FROM imports WHERE id=$1`,[prior.rows[0].id])).rows[0]?.column_mapping;
          const canEnrich=previous!==undefined&&previous.keyword===parsed.mapping.keyword&&Object.entries(previous).every(([field,column])=>Object.hasOwn(parsed.mapping,field)&&parsed.mapping[field as keyof CsvMapping]===column);
          if(!canEnrich)throw new ImportMappingConflict();
          const enriched=await enrichImportedOpportunityEvidence(client,prior.rows[0].id,parsed,observedAt);
          await client.query(`UPDATE imports SET column_mapping=$2::jsonb WHERE id=$1`,[prior.rows[0].id,JSON.stringify(parsed.mapping)]);
          return {importId:prior.rows[0].id,reused:true,created:0,enriched};
        }
        return {importId:prior.rows[0].id,reused:true,created:0};
      }

      const imp = await client.query<{ id: string }>(
        `INSERT INTO imports (filename, byte_size, sha256, source_type, schema_version, marketplace, blob_ciphertext,column_mapping)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
        [filename, parsed.byteSize, parsed.sha256, sourceType, schemaVersion, marketplace, ciphertext,JSON.stringify(parsed.mapping)],
      );
      const importId = imp.rows[0]?.id;
      if (!importId) throw new Error("import insert failed");
      const source = await client.query<{ id: string }>(
        `INSERT INTO sources (kind, label) VALUES ('csv', $1) RETURNING id`,
        [filename],
      );
      const sourceId = source.rows[0]?.id;
      if (!sourceId) throw new Error("Import source missing");
      const created: string[] = [];
      for (const row of parsed.rows) {
        const rowIns = await client.query<{ id: string }>(
          `INSERT INTO import_rows (import_id, row_number, raw_json, keyword_raw, normalized_keyword)
           VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`,
          [importId, row.rowNumber, JSON.stringify(row.raw), row.keywordRaw, row.normalizedKeyword],
        );
        const rowId = rowIns.rows[0]?.id;
        const found = await client.query<{ id: string; input_version: number; stage: Stage }>(
          `INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage,input_version)
           VALUES($1,$2,$3,'imported',1)
           ON CONFLICT(marketplace,normalized_keyword) DO UPDATE SET
             input_version=candidates.input_version+1,keyword_display=EXCLUDED.keyword_display,last_progress_at=now(),
             stage=CASE WHEN candidates.stage IN ('decision_recorded','rejected') OR candidates.blocked_reason='external_outcome_unknown'
               THEN candidates.stage ELSE 'imported' END,
             blocked_reason=CASE WHEN candidates.stage IN ('decision_recorded','rejected') OR candidates.blocked_reason='external_outcome_unknown'
               THEN candidates.blocked_reason ELSE NULL END
           RETURNING id,input_version,stage`,
          [marketplace,row.normalizedKeyword,row.keywordRaw],
        );
        const candidateId = found.rows[0]?.id;
        const inputVersion = found.rows[0]?.input_version;
        const candidateStage = found.rows[0]?.stage;
        if (candidateId) await client.query("UPDATE evaluations SET stale=true WHERE candidate_id=$1", [candidateId]);
        if (!candidateId || !rowId || inputVersion === undefined) throw new Error("candidate insert failed");
        await client.query(
          `INSERT INTO candidate_import_rows (candidate_id, import_row_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [candidateId, rowId],
        );
        await client.query(
          `INSERT INTO evidence (candidate_id, field, kind, value_text, source_id, observed_at)
           VALUES ($1,'keyword','measured',$2,$3,$4)`,
          [candidateId, row.keywordRaw, sourceId, observedAt],
        );
        const extra = [
          ["reviews", row.values.reviews, "reviews" in row.values],
          ["review_700_count", row.values.review_700_count, "review_700_count" in row.values],
          ["review_2000_count", row.values.review_2000_count, "review_2000_count" in row.values],
          ["top_price", row.values.top_price, "top_price" in row.values],
          ["monthly_revenue_competitors", row.values.monthly_revenue_competitors, "monthly_revenue_competitors" in row.values],
          ["opportunity_niche_score", row.values.opportunity_niche_score, "opportunity_niche_score" in row.values],
          ["opportunity_monthly_units", row.values.opportunity_monthly_units, "opportunity_monthly_units" in row.values],
          ["opportunity_monthly_price", row.values.opportunity_monthly_price, "opportunity_monthly_price" in row.values],
          ["opportunity_search_volume", row.values.opportunity_search_volume, "opportunity_search_volume" in row.values],
          ["opportunity_search_trend_30d", row.values.opportunity_search_trend_30d, "opportunity_search_trend_30d" in row.values],
          ["opportunity_search_trend_90d", row.values.opportunity_search_trend_90d, "opportunity_search_trend_90d" in row.values],
          ["opportunity_competition", row.values.opportunity_competition, "opportunity_competition" in row.values],
          ["opportunity_seasonality", row.values.opportunity_seasonality, "opportunity_seasonality" in row.values],
          ["opportunity_last_updated", row.values.opportunity_last_updated, "opportunity_last_updated" in row.values],
        ] as const;
        for (const [field, value, present] of extra) {
          if (!present) continue;
          await insertCellEvidence(client, candidateId, sourceId, observedAt, field, value);
        }
        const representativeAsin = row.values.representative_asin?.trim().toUpperCase();
        const terminalCandidate = candidateStage === 'decision_recorded' || candidateStage === 'rejected';
        if (representativeAsin) {
          if (!z.string().regex(/^[A-Z0-9]{10}$/).safeParse(representativeAsin).success) throw new Error('INVALID_REPRESENTATIVE_ASIN');
          if (!terminalCandidate) {
            await client.query(
              `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
               VALUES ($1,'api_validation',$2,$3::jsonb)
               ON CONFLICT (candidate_id, stage, input_version) DO UPDATE SET detail=EXCLUDED.detail`,
              [candidateId, inputVersion, JSON.stringify({ importId, rowNumber: row.rowNumber, representativeAsin })],
            );
            await client.query("UPDATE candidates SET stage='api_validation',blocked_reason=NULL,last_progress_at=now() WHERE id=$1", [candidateId]);
          }
        }
        await client.query(
          `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
           VALUES ($1,'imported',$2,$3::jsonb)
           ON CONFLICT (candidate_id, stage, input_version) DO NOTHING`,
          [candidateId, inputVersion, JSON.stringify({ importId, rowNumber: row.rowNumber })],
        );
        const applyRepresentativeAsin = Boolean(representativeAsin) && !terminalCandidate;
        const job: AdvanceJob = { candidateId, stage: applyRepresentativeAsin ? "api_validation" : "imported", inputVersion };
        if (candidateStage === "imported" || applyRepresentativeAsin) {
          const queued = await boss.send(JOB_ADVANCE, job, { db: txAdapter(client) });
          if (!queued) throw new Error("PIPELINE_ENQUEUE_FAILED");
        }
        created.push(candidateId);
      }
 return {importId,reused:false,created:created.length};
}

async function enrichImportedOpportunityEvidence(client:QueryConnection,importId:string,parsed:ParseResult,observedAt:string):Promise<number>{
 const sourceRows=await client.query<{candidate_id:string;row_number:number}>(`SELECT cir.candidate_id,ir.row_number FROM candidate_import_rows cir JOIN import_rows ir ON ir.id=cir.import_row_id WHERE ir.import_id=$1 ORDER BY ir.row_number`,[importId]);
 let enriched=0;
 for(const linked of sourceRows.rows){
  const row=parsed.rows.find(candidate=>candidate.rowNumber===linked.row_number);if(!row)continue;
  const source=(await client.query<{source_id:string}>(`SELECT source_id FROM evidence WHERE candidate_id=$1 AND field='keyword' ORDER BY created_at DESC,id DESC LIMIT 1`,[linked.candidate_id])).rows[0]?.source_id;if(!source)continue;
  for(const field of ['opportunity_niche_score','opportunity_monthly_units','opportunity_monthly_price','opportunity_search_volume','opportunity_search_trend_30d','opportunity_search_trend_90d','opportunity_competition','opportunity_seasonality','opportunity_last_updated'] as const){
   const value=row.values[field];if(value===undefined)continue;
   const existing=await client.query(`SELECT 1 FROM evidence WHERE candidate_id=$1 AND field=$2 AND source_id=$3 LIMIT 1`,[linked.candidate_id,field,source]);if(existing.rows.length)continue;
   if(value.trim()==='')await client.query(`INSERT INTO evidence(candidate_id,field,kind,reason,source_id) VALUES($1,$2,'unknown','empty',$3)`,[linked.candidate_id,field,source]);
   else await client.query(`INSERT INTO evidence(candidate_id,field,kind,value_text,source_id,observed_at) VALUES($1,$2,'measured',$3,$4,$5)`,[linked.candidate_id,field,value.trim(),source,observedAt]);
   enriched++;
  }
 }
 return enriched;
}

async function insertCellEvidence(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  candidateId: string,
  sourceId: string,
  observedAt: string,
  field: string,
  raw: string | undefined,
): Promise<void> {
  const parsedCell = parseNumericCell(raw, sourceId, observedAt);
  const isOpportunityObservation = field.startsWith('opportunity_');
  if (isOpportunityObservation) {
    if (raw === undefined || raw.trim() === '') {
      await client.query(
        `INSERT INTO evidence (candidate_id, field, kind, reason, source_id) VALUES ($1,$2,'unknown','empty',$3)`,
        [candidateId, field, sourceId],
      );
      return;
    }
    await client.query(
      `INSERT INTO evidence (candidate_id, field, kind, value_text, source_id, observed_at) VALUES ($1,$2,'measured',$3,$4,$5)`,
      [candidateId, field, raw.trim(), sourceId, observedAt],
    );
    return;
  }
  const isCount = ["reviews", "review_700_count", "review_2000_count", "monthly_revenue_competitors"].includes(field);
  const cell = isCount && parsedCell.kind !== "unknown" && (!Number.isSafeInteger(Number(parsedCell.value)) || Number(parsedCell.value) < 0)
    ? unknown("count_not_integer", sourceId) : parsedCell;
  if (cell.kind === "unknown") {
    await client.query(
      `INSERT INTO evidence (candidate_id, field, kind, reason, source_id)
       VALUES ($1,$2,'unknown',$3,$4)`,
      [candidateId, field, cell.reason, sourceId],
    );
    return;
  }
  await client.query(
    `INSERT INTO evidence (candidate_id, field, kind, value_text, source_id, observed_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [candidateId, field, cell.kind, cell.value, sourceId, observedAt],
  );
}
