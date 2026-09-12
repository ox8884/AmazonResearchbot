import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  recordSupplierQuote,
  QuoteSpecificationMissing,
  type Pool,
} from "@forge-ops/db";
import { candidateParams, quoteInput, specInput } from "./quote-schema.ts";
import {
  quoteView,
  readCurrentSettings,
  specView,
  type QuoteRow,
  type SpecRow,
} from "./quote-store.ts";

export function registerQuoteRoutes(
  app: FastifyInstance,
  pool: Pool,
  webOrigin: string,
) {
  const actor = (request: FastifyRequest) =>
    (request as FastifyRequest & { userId?: string }).userId;
  app.get("/api/candidates/:id/sourcing", async (request, reply) => {
    if (!actor(request))
      return reply
        .status(401)
        .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const params = candidateParams.safeParse(request.params);
    if (!params.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid candidate" });
    const id = params.data.id;
    const found = await pool.query("SELECT id FROM candidates WHERE id=$1", [
      id,
    ]);
    if (!found.rowCount)
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Candidate missing" });
    const settings = await readCurrentSettings(pool);
    const specs = await pool.query<SpecRow>(
      "SELECT * FROM spec_revisions WHERE candidate_id=$1 ORDER BY revision DESC",
      [id],
    );
    const quotes = await pool.query<QuoteRow>(
      "SELECT q.*,q.valid_until::text AS valid_until,l.inbox_message_id AS source_inbox_id FROM supplier_quotes q LEFT JOIN inbox_quote_records l ON l.quote_id=q.id WHERE q.candidate_id=$1 ORDER BY q.created_at,q.id",
      [id],
    );
    return {
      specs: specs.rows.map(specView),
      quotes: quotes.rows.map((q) => quoteView(q, settings)),
      settingsVersion: settings.version,
    };
  });
  app.post("/api/candidates/:id/specs", async (request, reply) => {
    const userId = actor(request);
    if (!userId)
      return reply
        .status(401)
        .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    if (request.headers.origin !== webOrigin)
      return reply
        .status(403)
        .send({ code: "ORIGIN_REJECTED", message: "Origin not allowed" });
    const params = candidateParams.safeParse(request.params);
    const body = specInput.safeParse(request.body);
    if (!params.success || !body.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check specification fields" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT id FROM candidates WHERE id=$1 FOR UPDATE",
        [params.data.id],
      );
      if (!found.rowCount) {
        await client.query("ROLLBACK");
        return reply
          .status(404)
          .send({ code: "NOT_FOUND", message: "Candidate missing" });
      }
      const b = body.data;
      const result = await client.query<SpecRow>(
        `INSERT INTO spec_revisions (candidate_id,revision,material,dimensions,packaging,requirements,requested_quantity,source)
        VALUES ($1,(SELECT coalesce(max(revision),0)+1 FROM spec_revisions WHERE candidate_id=$1),$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          params.data.id,
          b.material,
          b.dimensions,
          b.packaging,
          b.requirements,
          b.requestedQuantity,
          b.source,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Specification could not be saved");
      await client.query(
        "INSERT INTO audit_events (actor,action,target) VALUES ($1,'specification_recorded',$2)",
        [userId, row.id],
      );
      await client.query("COMMIT");
      return reply.status(201).send(specView(row));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.post("/api/candidates/:id/quotes", async (request, reply) => {
    const userId = actor(request);
    if (!userId)
      return reply
        .status(401)
        .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    if (request.headers.origin !== webOrigin)
      return reply
        .status(403)
        .send({ code: "ORIGIN_REJECTED", message: "Origin not allowed" });
    const params = candidateParams.safeParse(request.params);
    const body = quoteInput.safeParse(request.body);
    if (!params.success || !body.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check quote fields and evidence" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await recordSupplierQuote(client, {
        candidateId: params.data.id,
        input: body.data,
        actor: userId,
      });
      const view = quoteView(saved.row, saved.settings);
      await client.query("COMMIT");
      return reply.status(201).send(view);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof QuoteSpecificationMissing)
        return reply
          .status(404)
          .send({
            code: "SPEC_NOT_FOUND",
            message: "Matching specification missing",
          });
      throw error;
    } finally {
      client.release();
    }
  });
}
