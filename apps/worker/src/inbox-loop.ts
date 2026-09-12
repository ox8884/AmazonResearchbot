import type { Pool } from "@forge-ops/db";
import type { ApprovedMailProfileGrant } from "@forge-ops/integrations/mail/connection-types";
import {
  createImapInboxTransport,
  type InboxConnectorOptions,
} from "@forge-ops/integrations/mail/inbox";
import { resolveApprovedWorkMail } from "./mail-profile-access.ts";
import {
  inboxMailboxKey,
  readInboxCursor,
  storeInboxBatch,
  type InboxStoreResult,
} from "./inbox-store.ts";

type InboxRuntimeOptions = {
  readonly mode: string | undefined;
  readonly connector?: InboxConnectorOptions;
};
export type InboxCycleResult =
  | Extract<InboxStoreResult, { readonly kind: "stored" }>
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "disabled" };

async function recordFailure(
  pool: Pool,
  grant: ApprovedMailProfileGrant,
  reason: string,
): Promise<void> {
  await pool.query(
    `WITH previous AS (
    SELECT meta,created_at FROM audit_events
    WHERE actor='worker' AND action='mail_inbox_poll_failed' AND target=$1
      AND meta->>'profileVersion'=$2::text
    ORDER BY created_at DESC LIMIT 1
  ) INSERT INTO audit_events(actor,action,target,meta)
    SELECT 'worker','mail_inbox_poll_failed',$1,$3::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM previous WHERE meta->>'reason'=$4
        AND created_at >= COALESCE((SELECT max(updated_at) FROM inbox_mailboxes WHERE profile_id=$1::uuid AND mailbox_key=$5),'-infinity'::timestamptz)
    )`,
    [
      grant.id,
      grant.version,
      JSON.stringify({ reason, profileVersion: grant.version }),
      reason,
      inboxMailboxKey(grant),
    ],
  );
}

export function createInboxCycle(
  pool: Pool,
  key: Buffer,
  options: InboxRuntimeOptions,
): () => Promise<InboxCycleResult> {
  return async () => {
    if (
      options.mode !== "profile" &&
      options.mode !== "smtp"
    )
      return { kind: "disabled" };
    const approved = await resolveApprovedWorkMail(pool, key);
    if (!approved) return { kind: "disabled" };
    const { grant, access, activatedAt } = approved;
    const cursor = await readInboxCursor(pool, grant);
    let initialSince: Date | undefined;
    if (!cursor) {
      const oldest = await pool.query<{
        lower_bound: Date | null;
      }>(`SELECT min(COALESCE(a.started_at,a.created_at)) AS lower_bound
        FROM external_actions a JOIN rfq_drafts r ON r.id=a.rfq_id
        WHERE a.state IN ('sent','outcome_unknown') AND r.state IN ('awaiting_quote','outcome_unknown')`);
      const times = [activatedAt, oldest.rows[0]?.lower_bound].flatMap(
        (date) =>
          date instanceof Date && Number.isFinite(date.getTime())
            ? [date.getTime()]
            : [],
      );
      // IMAP SINCE has day precision; overlap a day so timezone differences cannot skip a reply.
      if (times.length)
        initialSince = new Date(Math.min(...times) - 24 * 60 * 60 * 1000);
    }
    const transport = createImapInboxTransport(grant, access, {
      ...options.connector,
      ...(initialSince ? { initialSince } : {}),
    });
    const read = await transport.read(cursor);
    if (read.kind === "blocked") {
      await recordFailure(pool, grant, read.reason);
      return read;
    }
    const stored = await storeInboxBatch(pool, key, {
      grant,
      batch: read.batch,
    });
    if (stored.kind === "blocked")
      await recordFailure(pool, grant, stored.reason);
    return stored;
  };
}
