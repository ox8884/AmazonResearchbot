import type { Pool, QueryConnection } from "@forge-ops/db";
import {
  dailySummaryPayloadSchema,
  summaryMailConsentSchema,
  summaryMailContent,
} from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
export type SummaryEnvelope = {
  summaryId: string;
  settingsVersion: number;
  recipient: string;
  subject: string;
  body: string;
};
export type SummaryDeliveryRow = {
  id: string;
  summary_id: string;
  settings_version: number;
  recipient: string;
  subject: string;
  body: string;
  payload_hash: string;
  state: string;
  retry_at: Date;
};
export async function currentSummaryEnvelope(
  db: QueryConnection,
  id: string,
  now = new Date(),
): Promise<SummaryEnvelope | null> {
  const row = (
    await db.query<{
      id: string;
      local_date: string;
      timezone: string;
      generated_at: Date;
      settings_version: number;
      payload: unknown;
      snapshot: unknown;
    }>(
      `
    SELECT s.id,s.local_date::text,s.timezone,s.generated_at,s.settings_version,s.payload,v.snapshot
    FROM daily_summaries s JOIN settings_versions v ON v.version=s.settings_version
    WHERE s.id=$1 AND v.version=(SELECT max(version) FROM settings_versions)
      AND s.local_date=($2::timestamptz AT TIME ZONE s.timezone)::date`,
      [id, now],
    )
  ).rows[0];
  if (!row) return null;
  const consent = summaryMailConsentSchema.safeParse(row.snapshot),
    content = dailySummaryPayloadSchema.safeParse(row.payload);
  if (!consent.success || !content.success) return null;
  const mail = summaryMailContent({
    id: row.id,
    localDate: row.local_date,
    timezone: row.timezone,
    generatedAt: row.generated_at.toISOString(),
    settingsVersion: row.settings_version,
    payload: content.data,
  });
  return {
    summaryId: row.id,
    settingsVersion: row.settings_version,
    recipient: consent.data.summaryEmail,
    ...mail,
  };
}
export const deliveryEnvelope = (row: SummaryDeliveryRow): SummaryEnvelope => ({
  summaryId: row.summary_id,
  settingsVersion: row.settings_version,
  recipient: row.recipient,
  subject: row.subject,
  body: row.body,
});
export async function prepareSummaryDelivery(
  pool: Pool,
  summaryId: string,
): Promise<string | null> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const envelope = await currentSummaryEnvelope(db, summaryId);
    if (!envelope) {
      await db.query("COMMIT");
      return null;
    }
    const existing = (
      await db.query<{ id: string }>(
        "SELECT id FROM summary_deliveries WHERE summary_id=$1",
        [summaryId],
      )
    ).rows[0];
    if (existing) {
      await db.query("COMMIT");
      return existing.id;
    }
    const saved = (
      await db.query<{ id: string }>(
        "INSERT INTO summary_deliveries(summary_id,settings_version,recipient,subject,body,payload_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          summaryId,
          envelope.settingsVersion,
          envelope.recipient,
          envelope.subject,
          envelope.body,
          exactPayloadHash(envelope),
        ],
      )
    ).rows[0];
    if (!saved) throw new Error("Summary delivery could not be prepared");
    await db.query("COMMIT");
    return saved.id;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
