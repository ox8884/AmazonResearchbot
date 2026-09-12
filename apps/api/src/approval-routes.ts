import { aiTestApprovalSchema } from "@forge-ops/domain";
import {
  customAiProviderActivationSchema,
  mailProfileActivationSchema,
} from "@forge-ops/domain";
import { orderPacketPayloadSchema } from "./order-schema.ts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "@forge-ops/db";
import { z } from "zod";
import { decideApproval } from "./approval-service.ts";
import { settingsApprovalSchema, type ApprovalRow } from "./approval-types.ts";
import { contactApprovalSchema } from "./rfq-schema.ts";

function approvalPayload(row: ApprovalRow): unknown | null {
  if (row.kind === "supplier_contact")
    return contactApprovalSchema.safeParse(row.payload).data ?? null;
  if (row.kind === "order_decision")
    return orderPacketPayloadSchema.safeParse(row.payload).data ?? null;
  if (row.kind === "provider_activation") {
    const test = aiTestApprovalSchema.safeParse(row.payload);
    if (test.success) return test.data;
    const custom = customAiProviderActivationSchema.safeParse(row.payload);
    if (custom.success) return custom.data;
    return mailProfileActivationSchema.safeParse(row.payload).data ?? null;
  }
  return settingsApprovalSchema.safeParse(row.payload).data ?? null;
}

export function registerApprovalRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/approvals", async (request, reply) => {
    const filters = z
      .object({
        kind: z
          .enum([
            "supplier_contact",
            "budget_or_criteria_change",
            "order_decision",
            "provider_activation",
          ])
          .optional(),
        status: z.enum(["pending", "approved", "rejected", "stale"]).optional(),
      })
      .strict()
      .safeParse(request.query);
    if (!filters.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid approval filter" });
    const result = await pool.query<ApprovalRow>(
      "SELECT * FROM approvals WHERE ($1::text IS NULL OR kind=$1) AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT 100",
      [filters.data.kind ?? null, filters.data.status ?? null],
    );
    return {
      approvals: result.rows.map((row) => {
        return {
          id: row.id,
          kind: row.kind,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          payload: approvalPayload(row),
        };
      }),
    };
  });
  for (const decision of ["approve", "reject"] as const) {
    app.post(`/api/approvals/:id/${decision}`, async (request, reply) => {
      if (
        !z
          .object({})
          .strict()
          .safeParse(request.body ?? {}).success
      )
        return reply
          .status(400)
          .send({
            code: "INVALID",
            message: "Approval contents cannot be changed here",
          });
      const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
      if (!parsed.success)
        return reply
          .status(400)
          .send({ code: "INVALID", message: "Invalid approval" });
      const actor = (request as FastifyRequest & { userId?: string }).userId;
      if (!actor)
        return reply
          .status(401)
          .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await decideApproval(
          client,
          parsed.data.id,
          actor,
          decision,
        );
        await client.query("COMMIT");
        if (!result.ok)
          return reply
            .status(result.code === "NOT_FOUND" ? 404 : 409)
            .send({
              code: result.code,
              message: "Approval needs review; no new action was dispatched",
            });
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }
}
