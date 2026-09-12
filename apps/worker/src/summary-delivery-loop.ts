import type { Pool } from "@forge-ops/db";
import type { MailTransport } from "@forge-ops/integrations/mail/transport";
import {
  prepareSummaryDelivery,
  dispatchSummaryDelivery,
  recoverSummaryDeliveries,
  reconcileSummaryDelivery,
} from "./summary-delivery.ts";
export async function runSummaryDeliveryCycle(
  pool: Pool,
  resolveTransport: () => Promise<MailTransport | null>,
): Promise<void> {
  await recoverSummaryDeliveries(pool);
  await pool.query(`UPDATE summary_deliveries d SET state='cancelled',reason='SUMMARY_SOURCE_CHANGED',finished_at=now()
    FROM daily_summaries s,settings_versions v WHERE d.summary_id=s.id AND v.version=(SELECT max(version) FROM settings_versions)
      AND d.state IN ('pending','blocked') AND (d.settings_version<>v.version OR v.snapshot->'summaryEmailEnabled' IS DISTINCT FROM 'true'::jsonb
        OR d.recipient IS DISTINCT FROM v.snapshot->>'summaryEmail' OR s.local_date<>(now() AT TIME ZONE s.timezone)::date)`);
  const latest = (
    await pool.query<{ id: string }>(
      "SELECT id FROM daily_summaries WHERE local_date=(now() AT TIME ZONE timezone)::date ORDER BY generated_at DESC LIMIT 1",
    )
  ).rows[0];
  if (latest) await prepareSummaryDelivery(pool, latest.id);
  const rows = (
    await pool.query<{ id: string; state: string }>(
      "SELECT id,state FROM summary_deliveries WHERE state='unknown' OR (state IN ('pending','blocked') AND retry_at<=now()) ORDER BY created_at DESC LIMIT 20",
    )
  ).rows;
  if (!rows.length) return;
  const transport = await resolveTransport();
  if (!transport) return;
  for (const row of rows) {
    if (row.state === "unknown")
      await reconcileSummaryDelivery(pool, row.id, transport);
    else await dispatchSummaryDelivery(pool, row.id, transport);
  }
}
