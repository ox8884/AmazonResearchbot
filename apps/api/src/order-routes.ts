import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { Pool } from "@forge-ops/db";
import {
  orderSourceSnapshot,
  reserveCash,
  type OrderPacketPayload,
} from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import {
  orderPacketInput,
  orderParams,
} from "./order-schema.ts";
import { registerOrderCancellation } from "./order-cancel.ts";
import {
  orderBudget,
  orderPacketView,
  reservationView,
  type LaunchCashReservationRow,
  type OrderPacketRow,
} from "./order-store.ts";
import {
  quoteView,
  readCurrentSettings,
  specView,
  type QuoteRow,
  type SpecRow,
} from "./quote-store.ts";
import { settingsSnapshotSchema } from "./settings-schema.ts";
import {currentOrderGoReady} from './order-validation.ts';
import {assessOrderRiskReview} from '@forge-ops/domain';

function actor(request: FastifyRequest): string | undefined {
  const value = Reflect.get(request, "userId");
  return typeof value === "string" ? value : undefined;
}

function unauthenticated(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply
    .status(401)
    .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
}

export function registerOrderRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/candidates/:id/orders", async (request, reply) => {
    if (!actor(request)) return unauthenticated(reply);
    const params = orderParams.safeParse(request.params);
    if (!params.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid candidate" });
    const candidate = await pool.query("SELECT id FROM candidates WHERE id=$1", [
      params.data.id,
    ]);
    if (!candidate.rows[0])
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Candidate missing" });
    const [settings, packets, reservations] = await Promise.all([
      readCurrentSettings(pool),
      pool.query<OrderPacketRow>(
        `SELECT p.*,a.status AS approval_status
         FROM order_packets p LEFT JOIN approvals a ON a.id=p.approval_id
         WHERE p.candidate_id=$1 ORDER BY p.created_at,p.id`,
        [params.data.id],
      ),
      pool.query<LaunchCashReservationRow>(
        "SELECT * FROM launch_cash_reservations WHERE candidate_id=$1 ORDER BY created_at,id",
        [params.data.id],
      ),
    ]);
    return {
      packets: packets.rows.map(orderPacketView),
      reservations: reservations.rows.map(reservationView),
      budget: await orderBudget(pool, settings.snapshot.launchBudgetUsd),
      settingsVersion: settings.version,
    };
  });

  app.get("/api/order-packets/:id", async (request, reply) => {
    if (!actor(request)) return unauthenticated(reply);
    const params = orderParams.safeParse(request.params);
    if (!params.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid order packet" });
    const result = await pool.query<OrderPacketRow>(
      `SELECT p.*,a.status AS approval_status
       FROM order_packets p LEFT JOIN approvals a ON a.id=p.approval_id
       WHERE p.id=$1`,
      [params.data.id],
    );
    const packet = result.rows[0];
    if (!packet)
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Order packet missing" });
    return { packet: orderPacketView(packet) };
  });

  app.post("/api/candidates/:id/order-packets", async (request, reply) => {
    const userId = actor(request);
    if (!userId) return unauthenticated(reply);
    const params = orderParams.safeParse(request.params);
    const body = orderPacketInput.safeParse(request.body);
    if (!params.success || !body.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check order decision fields" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
      const candidate = await client.query<{ id: string }>(
        "SELECT id FROM candidates WHERE id=$1 FOR UPDATE",
        [params.data.id],
      );
      if (!candidate.rows[0]) {
        await client.query("ROLLBACK");
        return reply
          .status(404)
          .send({ code: "NOT_FOUND", message: "Candidate missing" });
      }
      const current = await readCurrentSettings(client);
      const completeSettings = settingsSnapshotSchema.safeParse(current.snapshot);
      if (!completeSettings.success) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          code: "SETTINGS_REQUIRED",
          message: "Complete required business settings before recording an order decision",
        });
      }
      const quoteResult = await client.query<QuoteRow>(
        `SELECT q.*,q.valid_until::text AS valid_until
         FROM supplier_quotes q WHERE q.id=$1 AND q.candidate_id=$2`,
        [body.data.quoteId, params.data.id],
      );
      const quoteRow = quoteResult.rows[0];
      if (!quoteRow) {
        await client.query("ROLLBACK");
        return reply
          .status(404)
          .send({ code: "QUOTE_NOT_FOUND", message: "Quote missing" });
      }
      const specResult = await client.query<SpecRow>(
        "SELECT * FROM spec_revisions WHERE id=$1 AND candidate_id=$2",
        [quoteRow.spec_id, params.data.id],
      );
      const specRow = specResult.rows[0];
      if (!specRow) throw new Error("Quote specification missing");
      const quote = quoteView(quoteRow, current);
      const spec = specView(specRow);
      const validationPassed=await currentOrderGoReady(client,params.data.id,current);
      const cash = body.data.decision === "go" ? reserveCash(quote) : null;
      if (
        body.data.decision === "go" &&
        (quote.assessment.outcome !== "GO" ||
          !validationPassed ||
          assessOrderRiskReview(body.data.riskReview) !== "GO" ||
          cash === null)
      ) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          code: "ORDER_NOT_READY",
          message: "Current GO economics, official validation and confirmed market criteria are required",
        });
      }
      const packetId = randomUUID();
      const approvalId = randomUUID();
      const source = orderSourceSnapshot(spec, quote);
      const payload: OrderPacketPayload = {
        payloadVersion: 1,
        packetId,
        candidateId: params.data.id,
        decision: body.data.decision,
        note: body.data.note,
        settings: { version: current.version, snapshot: completeSettings.data },
        source,
        sourceHash: exactPayloadHash(source),
        assessment: quote.assessment,
        reservation: cash,
        ...(body.data.riskReview ? {riskReview: body.data.riskReview} : {}),
      };
      const payloadHash = exactPayloadHash(payload);
      await client.query(
        `INSERT INTO approvals(id,kind,candidate_id,payload_hash,payload,status)
         VALUES($1,'order_decision',$2,$3,$4::jsonb,'pending')`,
        [
          approvalId,
          params.data.id,
          payloadHash,
          JSON.stringify(payload),
        ],
      );
      await client.query(
        `INSERT INTO order_packets(id,candidate_id,quote_id,spec_id,settings_version,decision,note,payload,payload_hash,approval_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
        [
          packetId,
          params.data.id,
          quote.id,
          spec.id,
          current.version,
          body.data.decision,
          body.data.note,
          JSON.stringify(payload),
          payloadHash,
          approvalId,
          userId,
        ],
      );
      await client.query(
        "UPDATE candidates SET stage='awaiting_order_decision',blocked_reason=NULL,last_progress_at=now() WHERE id=$1",
        [params.data.id],
      );
      const saved = await client.query<OrderPacketRow>(
        `SELECT p.*,a.status AS approval_status
         FROM order_packets p JOIN approvals a ON a.id=p.approval_id
         WHERE p.id=$1`,
        [packetId],
      );
      const packet = saved.rows[0];
      if (!packet) throw new Error("Order packet could not be saved");
      await client.query("COMMIT");
      return reply.status(201).send({
        packet: orderPacketView(packet),
        approvalId,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  registerOrderCancellation(app, pool);
}
