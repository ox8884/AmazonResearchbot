import type { Pool } from "@forge-ops/db";
import { MAIL_QUOTE_PARSER_VERSION } from "@forge-ops/integrations/mail/quote-source";
import { recordMailQuote } from "@forge-ops/integrations/mail/quote-record";
export async function recordInboxQuotes(
  pool: Pool,
  key: Buffer,
): Promise<{ readonly recorded: number; readonly incomplete: number }> {
  const pending = await pool.query<{ id: string }>(
    `SELECT m.id FROM inbox_messages m
  LEFT JOIN inbox_message_links l ON l.inbox_message_id=m.id
  JOIN rfq_drafts r ON r.id=COALESCE(l.rfq_id,m.rfq_id)
  JOIN candidates c ON c.id=r.candidate_id
  WHERE (m.classification='linked' OR l.inbox_message_id IS NOT NULL)
   AND c.stage NOT IN ('decision_recorded','rejected')
   AND NOT EXISTS(SELECT 1 FROM inbox_quote_records q WHERE q.inbox_message_id=m.id AND (q.quote_id IS NOT NULL OR (q.mode='parsed' AND q.record_key=$1)))
  ORDER BY m.created_at,m.id LIMIT 20`,
    [MAIL_QUOTE_PARSER_VERSION],
  );
  let recorded = 0,
    incomplete = 0;
  for (const message of pending.rows) {
    const result = await recordMailQuote(pool, key, {
      mode: "parsed",
      messageId: message.id,
    });
    if (result.kind === "recorded" && !result.reused) recorded++;
    if (result.kind === "incomplete") incomplete++;
  }
  return { recorded, incomplete };
}
