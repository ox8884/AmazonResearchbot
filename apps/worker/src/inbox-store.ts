import type { Pool } from "@forge-ops/db";
import type { ApprovedMailProfileGrant } from "@forge-ops/integrations/mail/connection-types";
import type { InboxBatch, InboxCursor } from "@forge-ops/integrations/mail/inbox-types";
import { persistInboxMessage } from "./inbox-store-persist.ts";
import { inboxMailboxKey, profileIsCurrent, validBatch } from "./inbox-store-support.ts";

type CursorRow = { readonly uid_validity: string; readonly last_uid: string };
type NamespaceRow = CursorRow & { readonly id: string };
type StoreConnection = Pick<Pool, "query"> & { readonly release: () => void };
type BlockedReason = "INVALID_BATCH" | "INVALID_ENCRYPTION_KEY" | "MAILBOX_KEY_MISMATCH" | "PROFILE_NOT_CURRENT";

export type InboxStoreResult =
  | {
      readonly kind: "stored";
      readonly cursor: InboxCursor;
      readonly messagesStored: number;
      readonly linkedReplies: number;
      readonly duplicateMessages: number;
      readonly unclassifiedMessages: number;
      readonly conflictMessages: number;
    }
  | { readonly kind: "blocked"; readonly reason: BlockedReason };

function blocked(reason: BlockedReason): InboxStoreResult {
  return { kind: "blocked", reason };
}

export { inboxMailboxKey };

export async function readInboxCursor(
  pool: Pool,
  grant: ApprovedMailProfileGrant,
): Promise<InboxCursor | null> {
  if (!(await profileIsCurrent(pool, grant, false))) return null;
  const cursor = await pool.query<CursorRow>(
    `SELECT uid_validity,last_uid::text AS last_uid FROM inbox_mailboxes
      WHERE profile_id=$1 AND mailbox_key=$2
      ORDER BY updated_at DESC,id DESC LIMIT 1`,
    [grant.id, inboxMailboxKey(grant)],
  );
  const row = cursor.rows[0];
  if (!row) return null;
  const lastUid = Number(row.last_uid);
  return Number.isSafeInteger(lastUid) ? { uidValidity: row.uid_validity, lastUid } : null;
}

export async function storeInboxBatch(
  pool: Pool,
  key: Buffer,
  input: { readonly grant: ApprovedMailProfileGrant; readonly batch: InboxBatch },
): Promise<InboxStoreResult> {
  const { grant, batch } = input;
  if (key.length !== 32) return blocked("INVALID_ENCRYPTION_KEY");
  if (batch.mailboxKey !== inboxMailboxKey(grant)) return blocked("MAILBOX_KEY_MISMATCH");
  if (!validBatch(batch)) return blocked("INVALID_BATCH");
  const client: StoreConnection = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await profileIsCurrent(client, grant, true))) {
      await client.query("ROLLBACK");
      return blocked("PROFILE_NOT_CURRENT");
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `inbox.profile:${grant.id}:${batch.mailboxKey}`,
    ]);
    const namespace = await client.query<NamespaceRow>(
      `INSERT INTO inbox_mailboxes(profile_id,mailbox_key,uid_validity,last_uid,last_observed_at)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(profile_id,mailbox_key,uid_validity) DO UPDATE
         SET last_uid=GREATEST(inbox_mailboxes.last_uid,EXCLUDED.last_uid),
             last_observed_at=GREATEST(inbox_mailboxes.last_observed_at,EXCLUDED.last_observed_at),
             updated_at=now()
       RETURNING id,uid_validity,last_uid::text AS last_uid`,
      [grant.id, batch.mailboxKey, batch.uidValidity, batch.lastUid, batch.observedAt],
    );
    const cursor = namespace.rows[0];
    if (!cursor) throw new Error("Inbox namespace insert did not return a cursor");
    const counts = {
      messagesStored: 0,
      linkedReplies: 0,
      duplicateMessages: 0,
      unclassifiedMessages: 0,
      conflictMessages: 0,
    };
    for (const message of batch.messages) {
      const stored = await persistInboxMessage(client, cursor.id, grant, batch, message, key);
      if (stored.stored) counts.messagesStored += 1;
      if (stored.classification.kind === "linked") counts.linkedReplies += 1;
      if (stored.classification.kind === "duplicate") counts.duplicateMessages += 1;
      if (stored.classification.kind === "unclassified") counts.unclassifiedMessages += 1;
      if (stored.classification.kind === "conflict") counts.conflictMessages += 1;
    }
    await client.query("COMMIT");
    return {
      kind: "stored",
      cursor: { uidValidity: cursor.uid_validity, lastUid: Number(cursor.last_uid) },
      ...counts,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
