import { insertContactProposal } from "@forge-ops/db";
import { rfqSourceCurrent } from "@forge-ops/db";
import type { FastifyInstance } from "fastify";
import {
  contactEligibility,
  refreshContactStage,
  rfqView,
  type Pool,
  type RfqRow,
} from "@forge-ops/db";
import { contactPayload } from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import { uuidParams, replyInput } from "./rfq-schema.ts";
export function registerRfqApprovalRoutes(app: FastifyInstance, pool: Pool) {
  app.post("/api/rfqs/:id/approval", async (request, reply) => {
    const parsed = uuidParams.safeParse(request.params);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid draft" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('forge.settings'))",
      );
      const linked = await client.query<{ candidate_id: string }>(
        "SELECT candidate_id FROM rfq_drafts WHERE id=$1",
        [parsed.data.id],
      );
      if (linked.rows[0])
        await client.query("SELECT id FROM candidates WHERE id=$1 FOR UPDATE", [
          linked.rows[0].candidate_id,
        ]);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["rfq:" + parsed.data.id],
      );
      const found = await client.query<RfqRow>(
        "SELECT * FROM rfq_drafts WHERE id=$1 FOR UPDATE",
        [parsed.data.id],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return reply
          .status(404)
          .send({ code: "NOT_FOUND", message: "Draft missing" });
      }
      if (!(await rfqSourceCurrent(client, row))) {
        await client.query("ROLLBACK");
        return reply
          .status(409)
          .send({
            code: row.ai_task_id ? "AI_RFQ_STALE" : "RFQ_SOURCE_STALE",
            message: "The RFQ source or specification is no longer current",
          });
      }
      if (row.state === "pending_approval" && row.approval_id) {
        await client.query("COMMIT");
        return { approvalId: row.approval_id, rfq: rfqView(row), reused: true };
      }
      if (!["draft", "rejected", "stale"].includes(row.state)) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          code: "RFQ_FINAL",
          message: "Draft already approved or dispatched",
        });
      }
      const gate = await contactEligibility(client, row.candidate_id);
      if (!gate.ready) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          code: "CONTACT_NOT_READY",
          message: "Current official validation is required",
          reason: gate.reason,
        });
      }
      const payload = contactPayload(rfqView(row), gate.settingsVersion);
      const hash = exactPayloadHash(payload);
      const proposal = await insertContactProposal(client, payload, hash);
      await refreshContactStage(client, row.candidate_id);
      await client.query("COMMIT");
      return reply.status(201).send(proposal);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.get("/api/rfqs/:id/replies", async (request, reply) => {
    const parsed = uuidParams.safeParse(request.params);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid draft" });
    const rows = await pool.query(
      `SELECT p.id,p.source,p.received_at AS "receivedAt",p.message_id AS "messageId",p.body,p.created_at AS "createdAt",origin.id AS "inboxMessageId"
       FROM supplier_replies p LEFT JOIN LATERAL (
         SELECT m.id FROM inbox_messages m LEFT JOIN inbox_message_links l ON l.inbox_message_id=m.id
         WHERE l.supplier_reply_id=p.id OR (m.classification='linked' AND m.rfq_id=p.rfq_id AND m.message_id=p.message_id AND m.source_identity=p.source)
         ORDER BY m.created_at,m.id LIMIT 1
       ) origin ON true WHERE p.rfq_id=$1 ORDER BY p.created_at,p.id`,
      [parsed.data.id],
    );
    return { replies: rows.rows };
  });
  app.post("/api/rfqs/:id/replies", async (request, reply) => {
    const params = uuidParams.safeParse(request.params),
      parsed = replyInput.safeParse(request.body);
    if (!params.success || !parsed.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check reply source and date" });
    const exists = await pool.query("SELECT id FROM rfq_drafts WHERE id=$1", [
      params.data.id,
    ]);
    if (!exists.rowCount)
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Draft missing" });
    const b = parsed.data;
    const result = await pool.query(
      `INSERT INTO supplier_replies(rfq_id,source,received_at,message_id,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(rfq_id,message_id) DO NOTHING RETURNING id`,
      [params.data.id, b.source, b.receivedAt, b.messageId, b.body],
    );
    if (result.rows[0])
      return reply.status(201).send({ id: result.rows[0].id, reused: false });
    const prior = await pool.query<{ id: string; body: string }>(
      "SELECT id,body FROM supplier_replies WHERE rfq_id=$1 AND message_id=$2",
      [params.data.id, b.messageId],
    );
    if (!prior.rows[0] || prior.rows[0].body !== b.body)
      return reply.status(409).send({
        code: "REPLY_CONFLICT",
        message: "Existing message content differs; original preserved",
      });
    return { id: prior.rows[0].id, reused: true };
  });
}
