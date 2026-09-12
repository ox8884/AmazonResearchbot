import type {QueryConnection} from '@forge-ops/db';
import type {PgBoss} from 'pg-boss';
import {parseNumericCell,unknown,type Stage} from '@forge-ops/domain';
import {SYNTHETIC_SCHEMA,type ParseResult} from '@forge-ops/integrations/jungle-scout/csv';
import {encryptSecret} from '@forge-ops/security';
import {JOB_ADVANCE,txAdapter,type AdvanceJob} from './queue.ts';

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
        if(!prior.rows[0].mapping_matches)throw new ImportMappingConflict();
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
        ] as const;
        for (const [field, value, present] of extra) {
          if (!present) continue;
          await insertCellEvidence(client, candidateId, sourceId, observedAt, field, value);
        }
        await client.query(
          `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
           VALUES ($1,'imported',$2,$3::jsonb)
           ON CONFLICT (candidate_id, stage, input_version) DO NOTHING`,
          [candidateId, inputVersion, JSON.stringify({ importId, rowNumber: row.rowNumber })],
        );
        const job: AdvanceJob = { candidateId, stage: "imported", inputVersion };
        if (candidateStage === "imported") {
          const queued = await boss.send(JOB_ADVANCE, job, { db: txAdapter(client) });
          if (!queued) throw new Error("PIPELINE_ENQUEUE_FAILED");
        }
        created.push(candidateId);
      }
 return {importId,reused:false,created:created.length};
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
