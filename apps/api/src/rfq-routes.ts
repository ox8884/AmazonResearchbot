import { currentAiRfq } from "@forge-ops/db";
import type { FastifyInstance } from "fastify";
import {
  contactEligibility,
  refreshContactStage,
  rfqView,
  type Pool,
  type RfqRow,
} from "@forge-ops/db";
import type { SupplierRecord } from "@forge-ops/domain";
import {
  supplierInput,
  rfqInput,
  rfqAiQuery,
  uuidParams,
} from "./rfq-schema.ts";
type SupplierRow = {
  spec_id: string | null;
  id: string;
  candidate_id: string;
  name: string;
  email: string | null;
  source: string;
  observed_at: Date;
  match_status: SupplierRecord["matchStatus"];
  match_notes: string;
  created_at: Date;
};
const supplierView = (r: SupplierRow): SupplierRecord => ({
  id: r.id,
  specId: r.spec_id,
  candidateId: r.candidate_id,
  name: r.name,
  email: r.email,
  source: r.source,
  observedAt: r.observed_at.toISOString(),
  matchStatus: r.match_status,
  matchNotes: r.match_notes,
  createdAt: r.created_at.toISOString(),
});
export function registerRfqRoutes(
  app: FastifyInstance,
  pool: Pool,
  deliveryMode: "disabled" | "mailpit" | "profile" = "disabled",
) {
  app.get("/api/candidates/:id/contact", async (request, reply) => {
    const parsed = uuidParams.safeParse(request.params);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid candidate" });
    const id = parsed.data.id;
    const exists = await pool.query("SELECT id FROM candidates WHERE id=$1", [
      id,
    ]);
    if (!exists.rowCount)
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Candidate missing" });
    const suppliers = await pool.query<SupplierRow>(
      "SELECT * FROM sourcing_suppliers WHERE candidate_id=$1 ORDER BY created_at,id",
      [id],
    );
    const drafts = await pool.query<RfqRow>(
      `SELECT r.*,a.transport AS delivery_transport,a.state AS delivery_state,a.blocked_reason AS delivery_reason FROM rfq_drafts r LEFT JOIN LATERAL (SELECT transport,state,blocked_reason FROM external_actions WHERE rfq_id=r.id AND approval_id=r.approval_id ORDER BY created_at DESC,id DESC LIMIT 1) a ON true WHERE r.candidate_id=$1 ORDER BY r.created_at,r.id`,
      [id],
    );
    const gate = await contactEligibility(pool, id);
    const profile =
      deliveryMode === "profile"
        ? await pool.query<{ active: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM mail_profiles WHERE singleton_key=1 AND status='active' AND password_ciphertext IS NOT NULL) AS active",
          )
        : null;
    const effectiveMode =
      deliveryMode === "profile"
        ? profile?.rows[0]?.active
          ? "smtp"
          : "disabled"
        : deliveryMode;
    return {
      suppliers: suppliers.rows.map(supplierView),
      drafts: drafts.rows.map(rfqView),
      contactReady: gate.ready,
      blockedReason: gate.ready ? null : gate.reason,
      deliveryMode: effectiveMode,
    };
  });
  app.get("/api/candidates/:id/rfq-ai", async (request, reply) => {
    const params = uuidParams.safeParse(request.params),
      query = rfqAiQuery.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.status(400).send({ code: "INVALID" });
    return {
      suggestion: await currentAiRfq(
        pool,
        params.data.id,
        query.data.specId,
        query.data.quantity,
      ),
    };
  });
  app.post("/api/candidates/:id/suppliers", async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const parsed = supplierInput.safeParse(request.body);
    if (!params.success || !parsed.success)
      return reply.status(400).send({
        code: "INVALID",
        message: "Check supplier source and matching evidence",
      });
    const exists = await pool.query("SELECT id FROM candidates WHERE id=$1", [
      params.data.id,
    ]);
    if (!exists.rowCount)
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Candidate missing" });
    const b = parsed.data;
    if (b.specId) {
      const spec = await pool.query(
        "SELECT id FROM spec_revisions WHERE id=$1 AND candidate_id=$2",
        [b.specId, params.data.id],
      );
      if (!spec.rowCount)
        return reply
          .status(404)
          .send({
            code: "SOURCE_NOT_FOUND",
            message: "Specification does not belong to this candidate",
          });
    }
    const result = await pool.query<SupplierRow>(
      `INSERT INTO sourcing_suppliers(candidate_id,name,email,source,observed_at,match_status,match_notes,spec_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        params.data.id,
        b.name,
        b.email,
        b.source,
        b.observedAt,
        b.matchStatus,
        b.matchNotes,
        b.specId ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Supplier could not be saved");
    return reply.status(201).send(supplierView(row));
  });
  app.post("/api/candidates/:id/rfqs", async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const parsed = rfqInput.safeParse(request.body);
    if (!params.success || !parsed.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check draft fields" });
    const id = params.data.id,
      b = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('forge.settings'))",
      );
      await client.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      const suppliers = await client.query<SupplierRow>(
        "SELECT * FROM sourcing_suppliers WHERE id=$1 AND candidate_id=$2",
        [b.supplierId, id],
      );
      const supplier = suppliers.rows[0];
      const spec = await client.query(
        "SELECT id FROM spec_revisions WHERE id=$1 AND candidate_id=$2",
        [b.specId, id],
      );
      if (!supplier || !spec.rowCount) {
        await client.query("ROLLBACK");
        return reply.status(404).send({
          code: "SOURCE_NOT_FOUND",
          message: "Matching source or specification missing",
        });
      }
      if (
        !supplier.email ||
        supplier.match_status !== "matches" ||
        (supplier.spec_id !== null && supplier.spec_id !== b.specId)
      ) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          code: "SUPPLIER_NOT_READY",
          message: "Supplier email and specification match must be confirmed",
        });
      }
      if (b.aiTaskId) {
        const source = await currentAiRfq(client, id, b.specId, b.quantity);
        if (source?.aiTaskId !== b.aiTaskId) {
          await client.query("ROLLBACK");
          return reply
            .status(409)
            .send({
              code: "AI_RFQ_STALE",
              message:
                "AI source or specification changed; reload before saving",
            });
        }
      }
      const prior = await client.query<RfqRow>(
        "SELECT * FROM rfq_drafts WHERE candidate_id=$1 AND supplier_id=$2 AND spec_id=$3 AND state NOT IN ('rejected','stale') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [id, b.supplierId, b.specId],
      );
      const existing = prior.rows[0];
      if (existing) {
        if (
          existing.subject === b.subject &&
          existing.body === b.body &&
          existing.quantity === b.quantity &&
          (existing.ai_task_id ?? null) === (b.aiTaskId ?? null)
        ) {
          await client.query("COMMIT");
          return reply.status(200).send(rfqView(existing));
        }
        await client.query("ROLLBACK");
        return reply.status(409).send({
          code: "RFQ_ALREADY_OPEN",
          message: "An existing request must be resolved first",
        });
      }
      const result = await client.query<RfqRow>(
        `INSERT INTO rfq_drafts(candidate_id,supplier_id,spec_id,quantity,recipient,subject,body,ai_task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          id,
          b.supplierId,
          b.specId,
          b.quantity,
          supplier.email,
          b.subject,
          b.body,
          b.aiTaskId ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Draft could not be saved");
      await refreshContactStage(client, id);
      await client.query("COMMIT");
      return reply.status(201).send(rfqView(row));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
