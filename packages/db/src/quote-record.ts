import { refreshContactStage } from "./rfq-state.ts";
import type { Pool } from "./client.ts";
import {
  evaluateEconomics,
  quoteInputSchema,
  type QuoteRecord,
  type EconomicsAssessment,
  type QuoteInput,
  type SettingsSnapshot,
} from "@forge-ops/domain";
export type QuoteConnection = Pick<Pool, "query">;
export type ApprovedQuoteSettings = {
  readonly version: number;
  readonly snapshot: SettingsSnapshot;
};
export type SupplierQuoteRow = {
  readonly id: string;
  readonly candidate_id: string;
  readonly spec_id: string;
  readonly supplier_name: string;
  readonly supplier_source: string;
  readonly source_text: string;
  readonly received_at: Date;
  readonly valid_until: string | null;
  readonly incoterm: string;
  readonly quantity: number;
  readonly moq: number;
  readonly risks_confirmed: boolean;
  readonly risk_source: string;
  readonly cost_evidence: unknown;
  readonly saved_settings_version: number;
  readonly saved_assessment: EconomicsAssessment;
  readonly created_at: Date;
  readonly source_inbox_id?: string | null;
};
export class QuoteSpecificationMissing extends Error {
  constructor() {
    super("Matching specification missing");
  }
}
export async function readApprovedSettings(
  db: QuoteConnection,
): Promise<ApprovedQuoteSettings> {
  const result = await db.query<ApprovedQuoteSettings>(
    "SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1",
  );
  const settings = result.rows[0];
  if (!settings) throw new Error("Approved settings missing");
  return settings;
}
export async function recordSupplierQuote(
  db: QuoteConnection,
  command: {
    readonly candidateId: string;
    readonly input: QuoteInput;
    readonly actor: string;
  },
): Promise<{
  readonly row: SupplierQuoteRow;
  readonly settings: ApprovedQuoteSettings;
}> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  await db.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [
    command.candidateId,
  ]);
  const b = command.input;
  const found = await db.query(
    "SELECT id FROM spec_revisions WHERE id=$1 AND candidate_id=$2",
    [b.specId, command.candidateId],
  );
  if (!found.rowCount) throw new QuoteSpecificationMissing();
  const settings = await readApprovedSettings(db);
  const assessment = evaluateEconomics(b, settings.snapshot);
  const inserted = await db.query<SupplierQuoteRow>(
    `INSERT INTO supplier_quotes(candidate_id,spec_id,supplier_name,supplier_source,source_text,received_at,valid_until,incoterm,quantity,moq,risks_confirmed,risk_source,cost_evidence,saved_settings_version,saved_assessment)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb) RETURNING *,valid_until::text AS valid_until`,
    [
      command.candidateId,
      b.specId,
      b.supplierName,
      b.supplierSource,
      b.sourceText,
      b.receivedAt,
      b.validUntil,
      b.incoterm,
      b.quantity,
      b.moq,
      b.risksConfirmed,
      b.riskSource,
      JSON.stringify(b.costs),
      settings.version,
      JSON.stringify(assessment),
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("Quote could not be saved");
  await db.query(
    "INSERT INTO audit_events(actor,action,target) VALUES($1,'quote_recorded',$2)",
    [command.actor, row.id],
  );
  await refreshContactStage(db, command.candidateId);
  return { row, settings };
}

export function quoteRecordView(
  row: SupplierQuoteRow,
  settings: { version: number; snapshot: SettingsSnapshot },
): QuoteRecord {
  const parsed = quoteInputSchema.safeParse({
    specId: row.spec_id,
    supplierName: row.supplier_name,
    supplierSource: row.supplier_source,
    sourceText: row.source_text,
    receivedAt: row.received_at.toISOString(),
    validUntil: row.valid_until,
    incoterm: row.incoterm,
    quantity: row.quantity,
    moq: row.moq,
    risksConfirmed: row.risks_confirmed,
    riskSource: row.risk_source,
    costs: row.cost_evidence,
  });
  if (!parsed.success) throw new Error("Stored quote cannot be read");
  return {
    ...parsed.data,
    sourceText: row.source_text,
    supplierSource: row.supplier_source,
    id: row.id,
    candidateId: row.candidate_id,
    createdAt: row.created_at.toISOString(),
    savedSettingsVersion: row.saved_settings_version,
    settingsVersion: settings.version,
    stale: row.saved_settings_version !== settings.version,
    assessment: evaluateEconomics(parsed.data, settings.snapshot),
    savedAssessment: row.saved_assessment,
    ...(row.source_inbox_id ? { sourceInboxId: row.source_inbox_id } : {}),
  };
}
