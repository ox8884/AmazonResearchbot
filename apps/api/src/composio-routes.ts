import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "@forge-ops/db";
import { encryptSecret, decryptSecret } from "@forge-ops/security";
import {
  COMPOSIO_MCP_URL,
  ComposioError,
  createComposioRequest,
  type ComposioRequest,
} from "./composio-client.ts";
type Connection = {
  key_fingerprint: string;
  account_id: string | null;
  link_ciphertext: string | null;
  link_expires_at: Date | null;
  status: string;
  email: string | null;
  checked_at: Date | null;
};
function actor(request: FastifyRequest) {
  return "userId" in request && typeof request.userId === "string"
    ? request.userId
    : null;
}
export function registerComposioRoutes(
  app: FastifyInstance,
  pool: Pool,
  key: Buffer,
  options: { apiKey?: string; ownerEmail?: string; request?: ComposioRequest },
) {
  const configured = Boolean(options.apiKey?.trim()),
    fingerprint = createHash("sha256")
      .update("mcp-v1:" + (options.apiKey?.trim() ?? ""))
      .digest("hex");
  const remote = options.request ?? createComposioRequest(options.apiKey ?? "");
  const ownerEmail = options.ownerEmail ?? "jay@local.test";
  const seal = (value: string, userId: string, field: string) =>
    encryptSecret(Buffer.from(value), key, `composio:gmail:${userId}:${field}`);
  async function isOwner(userId: string) {
    return (
      (
        await pool.query(
          'SELECT 1 FROM "user" WHERE id=$1 AND lower(email)=lower($2)',
          [userId, ownerEmail],
        )
      ).rowCount === 1
    );
  }
  async function status(userId: string) {
    const row = (
      await pool.query<Connection>(
        "SELECT * FROM composio_gmail_connections WHERE user_id=$1",
        [userId],
      )
    ).rows[0];
    const expected =
      (
        await pool.query<{ email: string | null }>(
          "SELECT snapshot->>'summaryEmail' AS email FROM settings_versions ORDER BY version DESC LIMIT 1",
        )
      ).rows[0]?.email ?? null;
    const current = row?.key_fingerprint === fingerprint ? row : undefined;
    const state =
      current?.email &&
      expected &&
      current.email.toLowerCase() !== expected.toLowerCase()
        ? "mismatch"
        : (current?.status ?? "not_connected");
    return {
      configured,
      transport: "mcp",
      status: state,
      email: current?.email ?? null,
      expectedEmail: expected,
      checkedAt: current?.checked_at?.toISOString() ?? null,
    };
  }
  app.get("/api/connections/gmail", async (request, reply) => {
    const id = actor(request);
    if (!id) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    if (configured && !(await isOwner(id)))
      return reply.status(403).send({ code: "COMPOSIO_OWNER_ONLY" });
    return status(id);
  });
  for (const action of ["connect", "refresh"] as const) {
    app.post("/api/connections/gmail/" + action, async (request, reply) => {
      const userId = actor(request);
      if (!userId) return reply.status(401).send({ code: "UNAUTHENTICATED" });
      if (!configured)
        return reply.status(503).send({ code: "COMPOSIO_NOT_CONFIGURED" });
      if (!(await isOwner(userId)))
        return reply.status(403).send({ code: "COMPOSIO_OWNER_ONLY" });
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "composio:gmail:" + userId,
        ]);
        const expected = (
          await db.query<{ email: string | null }>(
            "SELECT snapshot->>'summaryEmail' AS email FROM settings_versions ORDER BY version DESC LIMIT 1",
          )
        ).rows[0]?.email;
        if (!expected) {
          await db.query("ROLLBACK");
          return reply.status(409).send({ code: "GMAIL_ADDRESS_REQUIRED" });
        }
        const prior = (
          await db.query<Connection>(
            "SELECT * FROM composio_gmail_connections WHERE user_id=$1 FOR UPDATE",
            [userId],
          )
        ).rows[0];
        const current =
          prior?.key_fingerprint === fingerprint ? prior : undefined;
        if (
          action === "connect" &&
          current?.status === "pending" &&
          current.link_ciphertext &&
          current.link_expires_at &&
          current.link_expires_at.getTime() > Date.now()
        ) {
          const redirectUrl = decryptSecret(
            current.link_ciphertext,
            key,
            `composio:gmail:${userId}:link`,
          ).toString("utf8");
          await db.query("COMMIT");
          return { redirectUrl };
        }
        const listed = await remote("list");
        const matching = listed.accounts.filter(
          (a) =>
            a.user_info?.emailAddress?.toLowerCase() === expected.toLowerCase(),
        );
        const active = matching.filter(
          (a) => a.status.toLowerCase() === "active",
        );
        const selected =
          active.find((a) => a.id === current?.account_id) ??
          (active.length === 1 ? active[0] : undefined);
        if (!selected && active.length > 1)
          throw new ComposioError("COMPOSIO_ACCOUNT_AMBIGUOUS");
        let state = selected
          ? "active"
          : matching.length > 0
            ? "expired"
            : listed.accounts.length > 0
              ? "mismatch"
              : "pending";
        let link: string | null = null,
          sessionId = listed.sessionId;
        if (!selected && action === "connect") {
          const added = await remote("add");
          if (!added.redirectUrl)
            throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
          link = added.redirectUrl;
          sessionId = added.sessionId;
          state = "pending";
        }
        await db.query(
          `INSERT INTO composio_gmail_connections(user_id,key_fingerprint,session_ciphertext,mcp_ciphertext,account_id,link_ciphertext,link_expires_at,status,email,checked_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $6::text IS NULL THEN NULL ELSE now()+interval '9 minutes' END,$7,$8,now()) ON CONFLICT(user_id) DO UPDATE SET key_fingerprint=$2,session_ciphertext=$3,mcp_ciphertext=$4,account_id=$5,link_ciphertext=$6,link_expires_at=EXCLUDED.link_expires_at,status=$7,email=$8,checked_at=now(),updated_at=now()`,
          [
            userId,
            fingerprint,
            seal(sessionId, userId, "session"),
            seal(COMPOSIO_MCP_URL, userId, "mcp"),
            selected?.id ?? null,
            link ? seal(link, userId, "link") : null,
            state,
            selected?.user_info?.emailAddress ?? null,
          ],
        );
        await db.query(
          "INSERT INTO audit_events(actor,action,target,meta) VALUES($1,'gmail_mcp_connection_checked','composio',$2::jsonb)",
          [userId, JSON.stringify({ status: state })],
        );
        await db.query("COMMIT");
        return link
          ? { redirectUrl: link }
          : {
              ...(await status(userId)),
              ...(action === "connect" && selected
                ? { alreadyConnected: true }
                : {}),
            };
      } catch (error) {
        await db.query("ROLLBACK");
        return reply
          .status(502)
          .send({
            code:
              error instanceof ComposioError
                ? error.code
                : "COMPOSIO_REQUEST_FAILED",
          });
      } finally {
        db.release();
      }
    });
  }
}
