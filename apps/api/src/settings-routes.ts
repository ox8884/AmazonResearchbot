import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "@forge-ops/db";
import { exactPayloadHash } from "@forge-ops/security";
import { parseSettingsChange } from "./settings-schema.ts";
import { readCurrentSettings } from "./quote-store.ts";
export function registerSettingsRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/settings", async () => readCurrentSettings(pool));
  app.post("/api/settings/proposals", async (request, reply) => {
    const actor = (request as FastifyRequest & { userId?: string }).userId;
    if (!actor)
      return reply
        .status(401)
        .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await readCurrentSettings(client);
      const result = parseSettingsChange(request.body, current.snapshot);
      if (result.kind === "invalid") {
        await client.query("ROLLBACK");
        return reply
          .status(400)
          .send({
            code: "INVALID_SETTINGS",
            message: "Check the proposed criteria",
            errors: result.errors,
          });
      }
      if (
        exactPayloadHash(current.snapshot) === exactPayloadHash(result.after)
      ) {
        await client.query("ROLLBACK");
        return reply
          .status(400)
          .send({ code: "NO_CHANGES", message: "No criteria changed" });
      }
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO settings_proposals(proposed_by,before_snapshot,after_snapshot,status) VALUES($1,$2::jsonb,$3::jsonb,'pending') RETURNING id",
        [actor, JSON.stringify(current.snapshot), JSON.stringify(result.after)],
      );
      const proposalId = inserted.rows[0]?.id;
      if (!proposalId) throw new Error("Proposal could not be saved");
      const payload = {
        payloadVersion: 1,
        proposalId,
        before: current.snapshot,
        after: result.after,
        settingsVersion: current.version,
      };
      const approval = await client.query<{ id: string }>(
        "INSERT INTO approvals(kind,payload_hash,payload,status) VALUES('budget_or_criteria_change',$1,$2::jsonb,'pending') RETURNING id",
        [exactPayloadHash(payload), JSON.stringify(payload)],
      );
      const approvalId = approval.rows[0]?.id;
      if (!approvalId) throw new Error("Approval could not be saved");
      await client.query("COMMIT");
      return reply
        .status(201)
        .send({
          proposalId,
          approvalId,
          before: current.snapshot,
          after: result.after,
        });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
