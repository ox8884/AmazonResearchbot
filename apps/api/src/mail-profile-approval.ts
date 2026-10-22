import { mailProfileActivationSchema } from "@forge-ops/domain";
import type { QueryConnection } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import type { ApprovalRow } from "./approval-types.ts";
import {
  mailProfileConfigFromRow,
  mailProfileFingerprint,
  profileColumns,
  readMailProfile,
  type MailProfileRow,
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
  const activated = await db.query<MailProfileRow>(
    `UPDATE mail_profiles SET status='active',activated_at=now(),updated_at=now() WHERE id=$1 AND status='pending_approval' RETURNING ${profileColumns}`,
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
