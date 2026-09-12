import { registerSecurityAuditRoutes } from "./security-audit-routes.ts";
import type { RecoveryCodeStorage } from "./recovery-code-storage.ts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import type { Pool } from "@forge-ops/db";
import type { LoginSession, TrustedDevice } from "@forge-ops/domain";
import type { createAuth } from "./auth.ts";
function deviceLabel(agent: string | null): string | null {
  if (!agent) return null;
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /(Chrome|CriOS)\//.test(agent)
        ? "Chrome"
        : /(Firefox|FxiOS)\//.test(agent)
          ? "Firefox"
          : /Version\/.*Safari\//.test(agent)
            ? "Safari"
            : null;
  const platform = /Android/.test(agent)
    ? "Android"
    : /(iPhone|iPad)/.test(agent)
      ? "iOS"
      : /Windows/.test(agent)
        ? "Windows"
        : /Macintosh/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : null;
  return [platform, browser].filter(Boolean).join(" · ") || null;
}
export function registerSecurityRoutes(
  app: FastifyInstance,
  pool: Pool,
  auth: ReturnType<typeof createAuth>,
  recoveryCodes: RecoveryCodeStorage,
) {
  registerSecurityAuditRoutes(app, pool);
  const sessionFor = (request: FastifyRequest) =>
    auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  app.get("/api/security/sessions", async (request, reply) => {
    const current = await sessionFor(request);
    if (!current) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const result = await pool.query<{
      id: string;
      user_agent: string | null;
      ip_address: string | null;
      created_at: Date;
      expires_at: Date;
    }>(
      "SELECT id,user_agent,ip_address,created_at,expires_at FROM session WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC,id",
      [current.user.id],
    );
    const sessions: LoginSession[] = result.rows.map((row) => ({
      id: row.id,
      current: row.id === current.session.id,
      device: deviceLabel(row.user_agent),
      address: row.ip_address?.trim() || null,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    }));
    return { sessions };
  });
  app.post("/api/security/sessions/:id/revoke", async (request, reply) => {
    const parsed = z
      .object({
        id: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[A-Za-z0-9_-]+$/),
      })
      .safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ code: "INVALID" });
    const current = await sessionFor(request);
    if (!current) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    if (parsed.data.id === current.session.id)
      return reply.status(400).send({ code: "CURRENT_SESSION" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const removed = await client.query(
        "DELETE FROM session WHERE id=$1 AND user_id=$2 RETURNING id",
        [parsed.data.id, current.user.id],
      );
      if (!removed.rowCount) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ code: "NOT_FOUND" });
      }
      await client.query(
        "INSERT INTO audit_events(actor,action,target) VALUES($1,'session_revoked',$2)",
        [current.user.id, parsed.data.id],
      );
      await client.query("COMMIT");
      return { revoked: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.get("/api/security/trusted-devices", async (request, reply) => {
    const current = await sessionFor(request);
    if (!current) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const rows = await pool.query<{
      id: string;
      user_agent: string | null;
      created_at: Date | null;
      expires_at: Date;
    }>(
      "SELECT id,user_agent,created_at,expires_at FROM verification WHERE value=$1 AND identifier LIKE 'trust-device-%' AND expires_at>now() ORDER BY created_at DESC,id",
      [current.user.id],
    );
    const devices: TrustedDevice[] = rows.rows.map((row) => ({
      id: row.id,
      device: deviceLabel(row.user_agent),
      createdAt: row.created_at?.toISOString() ?? null,
      expiresAt: row.expires_at.toISOString(),
    }));
    return { devices };
  });
  app.post(
    "/api/security/trusted-devices/:id/revoke",
    async (request, reply) => {
      const parsed = z
        .object({
          id: z
            .string()
            .min(1)
            .max(256)
            .regex(/^[A-Za-z0-9_-]+$/),
        })
        .safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ code: "INVALID" });
      const current = await sessionFor(request);
      if (!current) return reply.status(401).send({ code: "UNAUTHENTICATED" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const removed = await client.query(
          "DELETE FROM verification WHERE id=$1 AND value=$2 AND identifier LIKE 'trust-device-%' RETURNING id",
          [parsed.data.id, current.user.id],
        );
        if (!removed.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ code: "NOT_FOUND" });
        }
        await client.query(
          "INSERT INTO audit_events(actor,action,target) VALUES($1,'trusted_device_revoked',$2)",
          [current.user.id, parsed.data.id],
        );
        await client.query("COMMIT");
        return { revoked: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
  app.get("/api/security/recovery-codes", async (request, reply) => {
    const current = await sessionFor(request);
    if (!current) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const rows = await pool.query<{ backup_codes: string | null }>(
      "SELECT backup_codes FROM two_factor WHERE user_id=$1",
      [current.user.id],
    );
    if (rows.rows.length !== 1 || rows.rows[0]?.backup_codes == null)
      return { remaining: null };
    const codes: unknown = JSON.parse(
      await recoveryCodes.decrypt(rows.rows[0].backup_codes),
    );
    if (!Array.isArray(codes))
      throw new Error("Recovery code state unavailable");
    return { remaining: codes.length };
  });
}
