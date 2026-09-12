import { customAiProviderActivationSchema } from "@forge-ops/domain";
import type { QueryConnection } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import {
  customAiProfileColumns,
  customAiProfileConfigFingerprint,
  customAiProfileConfigFromRow,
  type CustomAiProfileRow,
} from "./ai-profile-core.ts";

export async function applyCustomAiProfileApproval(
  db: QueryConnection,
  approvalId: string,
  payload: unknown,
  payloadHash: string,
  userId: string,
  profile: CustomAiProfileRow | null,
): Promise<{ readonly applied: true } | { readonly applied: false; readonly code: "APPROVAL_STALE" }> {
  const parsed = customAiProviderActivationSchema.safeParse(payload);
  if (!parsed.success || exactPayloadHash(payload) !== payloadHash || !profile)
    return { applied: false, code: "APPROVAL_STALE" };
  const activation = parsed.data;
  if (
    profile.id !== activation.profileId ||
    profile.status !== "pending_approval" ||
    profile.version !== activation.version ||
    profile.key_revision !== activation.keyRevision ||
    customAiProfileConfigFingerprint(profile) !== activation.configFingerprint ||
    exactPayloadHash(customAiProfileConfigFromRow(profile)) !== exactPayloadHash(activation.displayedConfig)
  ) {
    return { applied: false, code: "APPROVAL_STALE" };
  }
  const activated = await db.query<CustomAiProfileRow>(
    `UPDATE custom_ai_profiles SET status='active',updated_at=now()
     WHERE id=$1 AND status='pending_approval' RETURNING ${customAiProfileColumns}`,
    [profile.id],
  );
  const current = activated.rows[0];
  if (!current) return { applied: false, code: "APPROVAL_STALE" };
  await db.query(
    "INSERT INTO audit_events(actor,action,target,approval_hash,meta) VALUES($1,'custom_ai_activated',$2,$3,$4::jsonb)",
    [userId, current.id, payloadHash, JSON.stringify({ version: current.version, keyRevision: current.key_revision, protocol: current.protocol, approvalId })],
  );
  return { applied: true };
}

export async function rejectCustomAiProfileApproval(
  db: QueryConnection,
  payload: unknown,
  payloadHash: string,
  profile: CustomAiProfileRow | null,
): Promise<boolean> {
  const parsed = customAiProviderActivationSchema.safeParse(payload);
  if (!parsed.success || exactPayloadHash(payload) !== payloadHash || !profile) return false;
  const activation = parsed.data;
  if (
    profile.id !== activation.profileId ||
    profile.status !== "pending_approval" ||
    profile.version !== activation.version ||
    profile.key_revision !== activation.keyRevision ||
    customAiProfileConfigFingerprint(profile) !== activation.configFingerprint
  ) return false;
  const reset = await db.query(
    "UPDATE custom_ai_profiles SET status='draft',updated_at=now() WHERE id=$1 AND status='pending_approval'",
    [profile.id],
  );
  return reset.rowCount === 1;
}
