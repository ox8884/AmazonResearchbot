import { launchBudgetAllows } from "./order-service.ts";
import type { QueryConnection } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import { readCurrentSettings } from "./quote-store.ts";
import { settingsApprovalSchema, type ApprovalRow } from "./approval-types.ts";
export async function applySettingsApproval(
  db: QueryConnection,
  row: ApprovalRow,
  userId: string,
): Promise<{ applied: true } | { applied: false; code: "APPROVAL_STALE" | "LAUNCH_BUDGET_RESERVED" }> {
  const parsed = settingsApprovalSchema.safeParse(row.payload);
  if (!parsed.success) return { applied: false, code: "APPROVAL_STALE" };
  const p = parsed.data,
    current = await readCurrentSettings(db);
  if (
    current.version !== p.settingsVersion ||
    exactPayloadHash(current.snapshot) !== exactPayloadHash(p.before)
  )
    return { applied: false, code: "APPROVAL_STALE" };
  const proposal = await db.query<{
    status: string;
    before_snapshot: unknown;
    after_snapshot: unknown;
  }>(
    "SELECT status,before_snapshot,after_snapshot FROM settings_proposals WHERE id=$1 FOR UPDATE",
    [p.proposalId],
  );
  const saved = proposal.rows[0];
  if (
    !saved ||
    saved.status !== "pending" ||
    exactPayloadHash(saved.before_snapshot) !== exactPayloadHash(p.before) ||
    exactPayloadHash(saved.after_snapshot) !== exactPayloadHash(p.after)
  )
    return { applied: false, code: "APPROVAL_STALE" };
  if (!(await launchBudgetAllows(db, p.after.launchBudgetUsd)))
    return { applied: false, code: "LAUNCH_BUDGET_RESERVED" };
  await db.query(
    "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),$2,$3::jsonb)",
    [current.version + 1, userId, JSON.stringify(p.after)],
  );
  await db.query("UPDATE evaluations SET stale=true");
  await db.query(
    "UPDATE settings_proposals SET status='approved' WHERE id=$1",
    [p.proposalId],
  );
  return { applied: true };
}
