import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";

export function registerSecurityAuditRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/security/audit", async (request, reply) => {
    if (!("userId" in request) || typeof request.userId !== "string")
      return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const events = await pool.query(
      `
      SELECT e.id,e.action,e.created_at AS "createdAt",
        a.kind AS "approvalKind",c.keyword_display AS "candidateKeyword"
      FROM audit_events e
      LEFT JOIN approvals a ON a.id::text=e.target
        AND e.action IN ('approve','reject','approval_invalidated')
      LEFT JOIN candidates c ON c.id=a.candidate_id
      WHERE e.actor=$1 AND e.action IN
        ('approve','reject','approval_invalidated','session_revoked','trusted_device_revoked')
      ORDER BY e.created_at DESC,e.id DESC LIMIT 50`,
      [request.userId],
    );
    return { events: events.rows };
  });
}
