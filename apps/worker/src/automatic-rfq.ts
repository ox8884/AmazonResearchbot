import {
  contactEligibility,
  currentAiRfq,
  insertContactProposal,
  refreshContactStage,
  rfqView,
  type Pool,
  type RfqRow,
} from "@forge-ops/db";
import { contactPayload, rfqTemplate } from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";

type Spec = {
  id: string;
  material: string;
  dimensions: string;
  packaging: string;
  requirements: string;
  requested_quantity: number;
};

export async function prepareAutomaticRfqs(
  pool: Pool,
  candidateId: string,
): Promise<number> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const candidate = (
      await db.query<{ keyword_display: string; stage: string }>(
        "SELECT keyword_display,stage FROM candidates WHERE id=$1 FOR UPDATE",
        [candidateId],
      )
    ).rows[0];
    const gate = await contactEligibility(db, candidateId);
    if (
      !candidate ||
      !gate.ready ||
      !["sourcing", "rfq_draft", "awaiting_contact_approval"].includes(
        candidate.stage,
      )
    ) {
      await db.query("COMMIT");
      return 0;
    }
    const spec = (
      await db.query<Spec>(
        "SELECT id,material,dimensions,packaging,requirements,requested_quantity FROM spec_revisions WHERE candidate_id=$1 ORDER BY revision DESC LIMIT 1",
        [candidateId],
      )
    ).rows[0];
    if (!spec) {
      await db.query("COMMIT");
      return 0;
    }
    const suppliers = (
      await db.query<{ id: string; email: string }>(
        `
      SELECT DISTINCT ON (lower(trim(s.email))) s.id,s.email FROM sourcing_suppliers s
      WHERE s.candidate_id=$1 AND s.spec_id=$2 AND s.match_status='matches'
        AND s.email IS NOT NULL AND trim(s.email)<>'' AND trim(s.source)<>'' AND trim(s.match_notes)<>''
        AND NOT EXISTS(SELECT 1 FROM rfq_drafts r WHERE r.candidate_id=s.candidate_id
          AND r.spec_id=s.spec_id AND lower(trim(r.recipient))=lower(trim(s.email)))
      ORDER BY lower(trim(s.email)),s.created_at,s.id`,
        [candidateId, spec.id],
      )
    ).rows;
    if (!suppliers.length) {
      await db.query("COMMIT");
      return 0;
    }
    const ai = await currentAiRfq(
      db,
      candidateId,
      spec.id,
      spec.requested_quantity,
    );
    const template =
      ai ??
      rfqTemplate({
        product: candidate.keyword_display,
        material: spec.material,
        dimensions: spec.dimensions,
        packaging: spec.packaging,
        requirements: spec.requirements,
        quantity: spec.requested_quantity,
      });
    const subject = template.subject.replace(/[\r\n]+/g, " ").slice(0, 200);
    for (const supplier of suppliers) {
      const rfq = (
        await db.query<RfqRow>(
          "INSERT INTO rfq_drafts(candidate_id,supplier_id,spec_id,quantity,recipient,subject,body,ai_task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            candidateId,
            supplier.id,
            spec.id,
            spec.requested_quantity,
            supplier.email,
            subject,
            template.body,
            ai?.aiTaskId ?? null,
          ],
        )
      ).rows[0];
      if (!rfq) throw new Error("Automatic RFQ could not be saved");
      const payload = contactPayload(rfqView(rfq), gate.settingsVersion);
      await insertContactProposal(db, payload, exactPayloadHash(payload));
    }
    await refreshContactStage(db, candidateId);
    await db.query("COMMIT");
    return suppliers.length;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function prepareReadyRfqs(pool: Pool): Promise<void> {
  const candidates = (
    await pool.query<{ id: string }>(`
    SELECT c.id FROM candidates c
    JOIN LATERAL (SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
    JOIN LATERAL (SELECT outcome,stale FROM evaluations WHERE candidate_id=c.id AND kind='api_validation'
      AND settings_version=v.version AND payload->>'inputVersion'=c.input_version::text
      ORDER BY created_at DESC,id DESC LIMIT 1) e ON e.outcome='pass' AND NOT e.stale
    WHERE c.stage IN ('sourcing','rfq_draft','awaiting_contact_approval') AND c.blocked_reason IS NULL
      AND EXISTS(SELECT 1 FROM sourcing_suppliers s WHERE s.candidate_id=c.id AND s.match_status='matches' AND s.email IS NOT NULL
        AND s.spec_id=(SELECT id FROM spec_revisions WHERE candidate_id=c.id ORDER BY revision DESC LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM rfq_drafts r WHERE r.candidate_id=c.id AND r.spec_id=s.spec_id AND lower(trim(r.recipient))=lower(trim(s.email))))
    ORDER BY c.last_progress_at NULLS FIRST,c.id LIMIT 20`)
  ).rows;
  for (const candidate of candidates)
    await prepareAutomaticRfqs(pool, candidate.id);
}
