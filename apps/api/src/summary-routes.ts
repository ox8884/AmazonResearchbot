import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";
import {
  dailySummaryPayloadSchema,
  type DailySummaryRecord,
  type SummaryDeliveryView,
} from "@forge-ops/domain";
import { z } from "zod";
export function registerSummaryRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/summaries", async () => {
    const rows = await pool.query<{
      id: string;
      local_date: string;
      timezone: string;
      settings_version: number;
      generated_at: Date;
    }>(
      "SELECT id,local_date::text,timezone,settings_version,generated_at FROM daily_summaries ORDER BY generated_at DESC,id DESC LIMIT 30",
    );
    return {
      summaries: rows.rows.map((row) => ({
        id: row.id,
        localDate: row.local_date,
        timezone: row.timezone,
        settingsVersion: row.settings_version,
        generatedAt: row.generated_at.toISOString(),
      })),
    };
  });
  app.get("/api/summaries/:id", async (request, reply) => {
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ code: "INVALID" });
    const row = (
      await pool.query<{
        id: string;
        local_date: string;
        timezone: string;
        settings_version: number;
        generated_at: Date;
        payload: unknown;
      }>(
        "SELECT id,local_date::text,timezone,settings_version,generated_at,payload FROM daily_summaries WHERE id=$1",
        [parsed.data.id],
      )
    ).rows[0];
    if (!row) return reply.status(404).send({ code: "NOT_FOUND" });
    const deliveryRow = (
      await pool.query<{
        state: SummaryDeliveryView["state"];
        recipient: string;
        attempt_count: number;
        reason: string | null;
        finished_at: Date | null;
        receipt: string | null;
      }>(
        "SELECT state,recipient,attempt_count,reason,finished_at,receipt FROM summary_deliveries WHERE summary_id=$1",
        [row.id],
      )
    ).rows[0];
    let localCapture = false;
    if (deliveryRow?.receipt) {
      try {
        const receipt: unknown = JSON.parse(deliveryRow.receipt);
        localCapture =
          typeof receipt === "object" &&
          receipt !== null &&
          "transport" in receipt &&
          receipt.transport === "mailpit";
      } catch {
        localCapture = false;
      }
    }
    const summary: DailySummaryRecord = {
      delivery: deliveryRow
        ? {
            state: deliveryRow.state,
            recipient: deliveryRow.recipient,
            attemptCount: deliveryRow.attempt_count,
            reason: deliveryRow.reason,
            finishedAt: deliveryRow.finished_at?.toISOString() ?? null,
            localCapture,
          }
        : null,
      id: row.id,
      localDate: row.local_date,
      timezone: row.timezone,
      settingsVersion: row.settings_version,
      generatedAt: row.generated_at.toISOString(),
      payload: dailySummaryPayloadSchema.parse(row.payload),
    };
    return summary;
  });
}
