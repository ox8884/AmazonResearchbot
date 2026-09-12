import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";
import { persistSupplierCapture } from "@forge-ops/integrations/sourcing/capture";
import { uuidParams } from "./rfq-schema.ts";

export function registerSupplierCaptureRoutes(app: FastifyInstance, pool: Pool, key: Buffer): void {
  app.post("/api/candidates/:id/supplier-captures", async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const body = request.body;
    if (!params.success || !body || typeof body !== "object" ||
        !("candidateId" in body) || body.candidateId !== params.data.id) {
      return reply.status(400).send({ code: "INVALID_CAPTURE" });
    }
    const result = await persistSupplierCapture(pool, { capture: body, encryptionKey: key });
    if (result.kind === "invalid") return reply.status(400).send({ code: "INVALID_CAPTURE" });
    if (result.kind === "stale") return reply.status(409).send({ code: "CAPTURE_SOURCE_STALE" });
    return reply.status(result.kind === "stored" ? 201 : 200).send(result);
  });
  app.get("/api/candidates/:id/supplier-captures", async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "INVALID_CANDIDATE" });
    const found = await pool.query("SELECT id FROM candidates WHERE id=$1", [params.data.id]);
    if (!found.rowCount) return reply.status(404).send({ code: "NOT_FOUND" });
    const rows = await pool.query<{
      id: string; supplier_id: string; spec_id: string; capture_method: "user_declared" | "aside_search_result" | "aside_product_detail"; source_page_url: string | null;
      search_query: string; company_url: string; product_url: string; observed_at: Date;
    }>("SELECT id,supplier_id,spec_id,capture_method,source_page_url,search_query,company_url,product_url,observed_at FROM supplier_captures WHERE candidate_id=$1 ORDER BY created_at,id", [params.data.id]);
    return { captures: rows.rows.map(row => ({
      id: row.id, supplierId: row.supplier_id, specId: row.spec_id,
      captureMethod: row.capture_method, sourcePageUrl: row.source_page_url, searchQuery: row.search_query,
      companyUrl: row.company_url, productUrl: row.product_url, observedAt: row.observed_at.toISOString(),
    })) };
  });
}
