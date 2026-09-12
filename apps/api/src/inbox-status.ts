import type { Pool } from "@forge-ops/db";
import type { InboxWorkspace } from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
export async function readInboxStatus(
  db: Pick<Pool, "query">,
  collectionEnabled: boolean,
): Promise<
  Pick<
    InboxWorkspace,
    "profileStatus" | "collectionEnabled" | "lastCheckedAt" | "lastError"
  >
> {
  const profiles = await db.query<{
    id: string;
    version: number;
    status: InboxWorkspace["profileStatus"];
    imap_host: string;
    imap_port: number;
    username: string;
    inbox_mailbox: string;
    has_secret: boolean;
  }>(
    "SELECT id,version,status,imap_host,imap_port,username,inbox_mailbox,password_ciphertext IS NOT NULL AS has_secret FROM mail_profiles WHERE singleton_key=1",
  );
  const profile = profiles.rows[0];
  let lastCheckedAt: string | null = null;
  let lastError: InboxWorkspace["lastError"] = null;
  if (profile) {
    const mailboxKey = exactPayloadHash({
      imapHost: profile.imap_host,
      imapPort: profile.imap_port,
      username: profile.username,
      mailbox: profile.inbox_mailbox,
    });
    const checked = await db.query<{
      checked: Date | null;
      saved: Date | null;
    }>(
      "SELECT max(last_observed_at) AS checked,max(updated_at) AS saved FROM inbox_mailboxes WHERE profile_id=$1 AND mailbox_key=$2",
      [profile.id, mailboxKey],
    );
    lastCheckedAt = checked.rows[0]?.checked?.toISOString() ?? null;
    const errors = await db.query<{ code: string | null; created_at: Date }>(
      `SELECT meta->>'reason' AS code,created_at FROM audit_events WHERE target=$1
   AND action IN ('mail_inbox_poll_failed','mail_profile_connection_rejected')
   AND (meta->>'profileVersion'=$2::text OR meta->>'version'=$2::text)
   AND created_at>COALESCE($3::timestamptz,'-infinity'::timestamptz)
   ORDER BY created_at DESC LIMIT 1`,
      [profile.id, profile.version, checked.rows[0]?.saved ?? null],
    );
    const error = errors.rows[0];
    if (error)
      lastError = {
        code: error.code ?? "MAIL_INBOX_UNAVAILABLE",
        at: error.created_at.toISOString(),
      };
  }
  return {
    profileStatus: profile?.status ?? "unconfigured",
    collectionEnabled:
      collectionEnabled && profile?.status === "active" && profile.has_secret,
    lastCheckedAt,
    lastError,
  };
}
