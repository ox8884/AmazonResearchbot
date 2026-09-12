import { aiTestApprovalSchema } from "@forge-ops/domain";
import { validateAiTestApproval } from "./ai-test-service.ts";
import {
  customAiProviderActivationSchema,
  mailProfileActivationSchema,
} from "@forge-ops/domain";
import {
  lockCustomAiProfile,
  type CustomAiProfileRow,
} from "./ai-profile-core.ts";
import {
  applyCustomAiProfileApproval,
  rejectCustomAiProfileApproval,
} from "./ai-profile-approval.ts";
import { applyMailProfileApproval } from "./mail-profile-approval.ts";
import { applyOrderApproval } from "./order-service.ts";
import {
  refreshContactStage,
  contactEligibility,
  type QueryConnection,
} from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import { applySettingsApproval } from "./approval-settings.ts";
import {
  applyContactApproval,
  rejectContactApproval,
} from "./approval-contact.ts";
import { settingsApprovalSchema } from "./approval-types.ts";
import type { ApprovalRow, DecisionResult } from "./approval-types.ts";
export async function decideApproval(
  db: QueryConnection,
  id: string,
  userId: string,
  decision: "approve" | "reject",
): Promise<DecisionResult> {
  const first = await db.query<ApprovalRow>(
    "SELECT * FROM approvals WHERE id=$1",
    [id],
  );
  const peek = first.rows[0];
  if (!peek) return { ok: false, code: "NOT_FOUND" };
  const customActivation =
    peek.kind === "provider_activation"
      ? customAiProviderActivationSchema.safeParse(peek.payload)
      : null;
  const customTest = peek.kind === "provider_activation" ? aiTestApprovalSchema.safeParse(peek.payload) : null;
  let customProfile: CustomAiProfileRow | null = null;
  if (customTest?.success) customProfile = await lockCustomAiProfile(db, customTest.data.profileId);
  if (customActivation?.success)
    customProfile = await lockCustomAiProfile(db, customActivation.data.profileId);
  if (["budget_or_criteria_change", "order_decision", "supplier_contact"].includes(peek.kind))
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  if (["budget_or_criteria_change", "order_decision"].includes(peek.kind))
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.launch_cash'))");
  if (peek.kind === "provider_activation" && mailProfileActivationSchema.safeParse(peek.payload).success)
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.mail_profile'))");
  if (peek.kind === "supplier_contact") {
    const linked = await db.query<{ id: string; candidate_id: string }>(
      "SELECT id,candidate_id FROM rfq_drafts WHERE approval_id=$1",
      [id],
    );
    if (!linked.rows[0]) return { ok: false, code: "APPROVAL_STALE" };
    await db.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [linked.rows[0].candidate_id]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "rfq:" + linked.rows[0].id,
    ]);
  }
  const found = await db.query<ApprovalRow>(
    "SELECT * FROM approvals WHERE id=$1 FOR UPDATE",
    [id],
  );
  const row = found.rows[0];
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (decision === "reject") {
    if (row.status === "rejected")
      return { ok: true, id, status: "rejected", reused: true };
    if (!["pending", "approved"].includes(row.status))
      return { ok: false, code: "APPROVAL_STALE" };
    if (row.kind === "supplier_contact") {
      if (!(await rejectContactApproval(db, row)))
        return { ok: false, code: "ALREADY_DISPATCHED" };
    } else if (customActivation?.success) {
      if (!(await rejectCustomAiProfileApproval(db, row.payload, row.payload_hash, customProfile))) {
        await db.query("UPDATE approvals SET status='stale' WHERE id=$1", [id]);
        return { ok: false, code: "APPROVAL_STALE" };
      }
    } else if (row.status === "approved")
      return { ok: false, code: "ALREADY_APPLIED" };
    if (row.kind === "order_decision")
      await db.query("UPDATE order_packets SET state='cancelled' WHERE approval_id=$1 AND state='pending_approval'", [id]);
    const settings = settingsApprovalSchema.safeParse(row.payload);
    if (
      row.kind === "budget_or_criteria_change" &&
      settings.success &&
      exactPayloadHash(row.payload) === row.payload_hash
    )
      await db.query(
        "UPDATE settings_proposals SET status='rejected' WHERE id=$1 AND status='pending'",
        [settings.data.proposalId],
      );
    await db.query(
      "UPDATE approvals SET status='rejected',decided_at=now(),decided_by=$2 WHERE id=$1",
      [id, userId],
    );
    await db.query(
      "INSERT INTO audit_events(actor,action,target,approval_hash) VALUES($1,'reject',$2,$3)",
      [userId, id, row.payload_hash],
    );
    return { ok: true, id, status: "rejected" };
  }
  if (row.status === "approved")
    return { ok: true, id, status: "approved", reused: true };
  if (row.status !== "pending") return { ok: false, code: "APPROVAL_STALE" };
  if (!["supplier_contact", "budget_or_criteria_change", "order_decision", "provider_activation"].includes(row.kind))
    return { ok: false, code: "APPROVAL_KIND_UNAVAILABLE" };
  let valid = exactPayloadHash(row.payload) === row.payload_hash;
  if (valid && row.kind === "supplier_contact") {
    valid = await applyContactApproval(db, row);
  } else if (valid) {
    const result = customTest?.success
      ? validateAiTestApproval(row.payload, row.payload_hash, customProfile)
      : customActivation?.success
      ? await applyCustomAiProfileApproval(
        db,
        row.id,
        row.payload,
        row.payload_hash,
        userId,
        customProfile,
      )
      : row.kind === "order_decision"
        ? await applyOrderApproval(db, row, userId)
        : row.kind === "provider_activation"
          ? await applyMailProfileApproval(db, row, userId)
          : await applySettingsApproval(db, row, userId);
    if (!result.applied && result.code !== "APPROVAL_STALE")
      return { ok: false, code: result.code };
    valid = result.applied;
  }
  if (!valid) {
    await db.query("UPDATE approvals SET status='stale' WHERE id=$1", [id]);
    if (row.kind === "order_decision")
      await db.query("UPDATE order_packets SET state='stale' WHERE approval_id=$1 AND state='pending_approval'", [id]);
    const settings = settingsApprovalSchema.safeParse(row.payload);
    if (
      row.kind === "budget_or_criteria_change" &&
      settings.success &&
      exactPayloadHash(row.payload) === row.payload_hash
    )
      await db.query(
        "UPDATE settings_proposals SET status='stale' WHERE id=$1 AND status='pending'",
        [settings.data.proposalId],
      );
    if (row.kind === "supplier_contact") {
      const drafts = await db.query<{ candidate_id: string }>(
        "UPDATE rfq_drafts SET state='stale' WHERE approval_id=$1 AND state='pending_approval' RETURNING candidate_id",
        [id],
      );
      if (drafts.rows[0]) {
        const candidateId = drafts.rows[0].candidate_id;
        await refreshContactStage(db, candidateId);
        const gate = await contactEligibility(db, candidateId);
        if (!gate.ready && gate.reason === "VALIDATION_REQUIRED")
          await db.query(
            "UPDATE candidates SET blocked_reason='evidence' WHERE id=$1",
            [candidateId],
          );
      }
    }
    await db.query(
      "INSERT INTO audit_events(actor,action,target,approval_hash) VALUES($1,'approval_invalidated',$2,$3)",
      [userId, id, row.payload_hash],
    );
    return { ok: false, code: "APPROVAL_STALE" };
  }
  await db.query(
    "UPDATE approvals SET status='approved',decided_at=now(),decided_by=$2 WHERE id=$1",
    [id, userId],
  );
  await db.query(
    "INSERT INTO audit_events(actor,action,target,approval_hash) VALUES($1,'approve',$2,$3)",
    [userId, id, row.payload_hash],
  );
  return { ok: true, id, status: "approved" };
}
