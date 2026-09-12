import { mailProfileActivationSchema } from "@forge-ops/domain";
import type { QueryConnection } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import type { ApprovalRow } from "./approval-types.ts";
import {
  mailProfileConfigFromRow,
  mailProfileFingerprint,
  readMailProfile,
  recordMailProfileHistory,
} from "./mail-profile-store.ts";

export async function applyMailProfileApproval(
  db: QueryConnection,
  row: ApprovalRow,
  userId: string,
): Promise<{ readonly applied: true } | { readonly applied: false; readonly code: "APPROVAL_STALE" }> {
  const parsed = mailProfileActivationSchema.safeParse(row.payload);
  if (!parsed.success || exactPayloadHash(row.payload) !== row.payload_hash)
    return { applied: false, code: "APPROVAL_STALE" };
  const payload = parsed.data;
  const profile = await readMailProfile(db, true);
  if (
    !profile ||
    profile.id !== payload.profileId ||
    profile.status !== "pending_approval" ||
    profile.version !== payload.version ||
    profile.secret_version !== payload.secretVersion ||
    profile.config_fingerprint !== payload.configFingerprint ||
    exactPayloadHash(mailProfileConfigFromRow(profile)) !== exactPayloadHash(payload.config) ||
    mailProfileFingerprint(profile.id, mailProfileConfigFromRow(profile), profile.secret_version) !== payload.configFingerprint
  ) {
    return { applied: false, code: "APPROVAL_STALE" };
  }
  const activated = await db.query<{
    readonly id: string;
    readonly name: string;
    readonly smtp_host: string;
    readonly smtp_port: 465 | 587;
    readonly imap_host: string;
    readonly imap_port: 993;
    readonly sender: string;
    readonly username: string;
    readonly sent_mailbox: string;
    readonly inbox_mailbox: string;
    readonly password_ciphertext: string | null;
    readonly password_last4: string | null;
    readonly secret_version: number;
    readonly config_fingerprint: string;
    readonly version: number;
    readonly status: "pending_approval" | "active" | "disabled";
  }>(
    `UPDATE mail_profiles SET status='active',activated_at=now(),updated_at=now() WHERE id=$1 AND status='pending_approval' RETURNING id,name,smtp_host,smtp_port,imap_host,imap_port,sender,username,sent_mailbox,inbox_mailbox,password_ciphertext,password_last4,secret_version,config_fingerprint,version,status`,
    [profile.id],
  );
  const current = activated.rows[0];
  if (!current) return { applied: false, code: "APPROVAL_STALE" };
  await recordMailProfileHistory(db, current, "activated", userId, row.id);
  await db.query(
    "INSERT INTO audit_events(actor,action,target,approval_hash,meta) VALUES($1,'mail_profile_activated',$2,$3,$4::jsonb)",
    [userId, current.id, row.payload_hash, JSON.stringify({ version: current.version, secretUpdated: false, connectionStatus: "unverified" })],
  );
  return { applied: true };
}
