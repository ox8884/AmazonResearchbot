import { inboxCaptureOwner } from "@forge-ops/domain";
import { createHash } from "node:crypto";
import type { Pool } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import type { ApprovedMailProfileGrant } from "@forge-ops/integrations/mail/connection-types";
import type { InboxBatch, InboxMessage } from "@forge-ops/integrations/mail/inbox-types";

export type QueryConnection = Pick<Pool, "query">;

export type Classification = {
  readonly kind: "linked" | "unclassified" | "duplicate" | "conflict";
  readonly reason: string;
  readonly rfqId: string | null;
};

export function inboxMailboxKey(grant: ApprovedMailProfileGrant): string {
  return exactPayloadHash({
    imapHost: grant.config.imapHost,
    imapPort: grant.config.imapPort,
    username: grant.config.username,
    mailbox: grant.config.inboxMailbox,
  });
}

function grantFingerprint(grant: ApprovedMailProfileGrant): string {
  return exactPayloadHash({
    profileId: grant.id,
    config: grant.config,
    secretVersion: grant.secretVersion,
  });
}

export function sourceHash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function captureAad(
  grant: ApprovedMailProfileGrant,
  batch: InboxBatch,
  message: InboxMessage,
  item: string,
): string {
  return inboxCaptureOwner({ profileId: grant.id, mailboxKey: batch.mailboxKey, uidValidity: batch.uidValidity, uid: message.uid }, item);
}

export function receivedAt(value: string | null): string | null {
  if (value === null || !Number.isFinite(Date.parse(value))) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate())
    return null;
  return value;
}

export function validBatch(batch: InboxBatch): boolean {
  if (
    !batch.uidValidity.trim() ||
    !Number.isSafeInteger(batch.lastUid) ||
    batch.lastUid < 0 ||
    !Number.isFinite(Date.parse(batch.observedAt))
  )
    return false;
  const seen = new Set<number>();
  for (const message of batch.messages) {
    if (
      !Number.isSafeInteger(message.uid) ||
      message.uid <= 0 ||
      message.uid > batch.lastUid ||
      seen.has(message.uid)
    )
      return false;
    seen.add(message.uid);
  }
  return true;
}

export async function profileIsCurrent(
  db: QueryConnection,
  grant: ApprovedMailProfileGrant,
  lock: boolean,
): Promise<boolean> {
  const current = await db.query(
    `SELECT id FROM mail_profiles
      WHERE id=$1 AND version=$2 AND secret_version=$3 AND config_fingerprint=$4
        AND status='active'${lock ? " FOR SHARE" : ""}`,
    [grant.id, grant.version, grant.secretVersion, grantFingerprint(grant)],
  );
  return current.rowCount === 1;
}
