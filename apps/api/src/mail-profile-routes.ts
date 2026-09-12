import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "@forge-ops/db";
import {
  createMailProfileActivationProposal,
  disableMailProfile,
  mailProfileView,
  readMailProfile,
  saveMailProfile,
} from "./mail-profile-store.ts";
import {
  mailProfileDisableRequestSchema,
  mailProfileProposalRequestSchema,
  mailProfileSaveRequestSchema,
} from "./mail-profile-schema.ts";

function actorId(request: FastifyRequest): string | undefined {
  const value = Reflect.get(request, "userId");
  return typeof value === "string" ? value : undefined;
}

function codeFor(result: "stale" | "not_configured" | "secret_required" | "already_active" | "invalid_host"): string {
  switch (result) {
    case "stale":
      return "APPROVAL_STALE";
    case "not_configured":
      return "MAIL_PROFILE_NOT_CONFIGURED";
    case "secret_required":
      return "MAIL_PROFILE_SECRET_REQUIRED";
    case "already_active":
      return "MAIL_PROFILE_ALREADY_ACTIVE";
    case "invalid_host":
      return "MAIL_HOST_INVALID";
  }
}

export function registerMailProfileRoutes(app: FastifyInstance, pool: Pool, key: Buffer): void {
  app.get("/api/mail-profile", async () => ({ profile: mailProfileView(await readMailProfile(pool)) }));

  app.post("/api/mail-profile", async (request, reply) => {
    const parsed = mailProfileSaveRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ code: "INVALID_MAIL_PROFILE", message: "Check the work mail profile fields" });
    const actor = actorId(request);
    if (!actor) return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await saveMailProfile(client, parsed.data, key, actor);
      if (result.kind === "stale" || result.kind === "invalid_host") {
        await client.query("ROLLBACK");
        return reply.status(result.kind === "stale" ? 409 : 400).send({ code: codeFor(result.kind), message: "Mail profile could not be saved" });
      }
      await client.query("COMMIT");
      return reply.status(result.created ? 201 : 200).send({ profile: result.profile });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/mail-profile/activation-proposals", async (request, reply) => {
    const parsed = mailProfileProposalRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success)
      return reply.status(400).send({ code: "INVALID_MAIL_PROFILE", message: "Check the activation proposal" });
    const actor = actorId(request);
    if (!actor) return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await createMailProfileActivationProposal(client, actor, parsed.data.expectedVersion);
      if (result.kind === "stale" || result.kind === "not_configured" || result.kind === "secret_required" || result.kind === "already_active") {
        await client.query("ROLLBACK");
        return reply.status(result.kind === "stale" ? 409 : 400).send({ code: codeFor(result.kind), message: "Mail profile activation needs review" });
      }
      await client.query("COMMIT");
      return reply.status(result.kind === "created" ? 201 : 200).send({ approvalId: result.approvalId, reused: result.kind === "reused", profile: result.profile });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/mail-profile/disable", async (request, reply) => {
    const parsed = mailProfileDisableRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success)
      return reply.status(400).send({ code: "INVALID_MAIL_PROFILE", message: "Check the disable request" });
    const actor = actorId(request);
    if (!actor) return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await disableMailProfile(client, actor, parsed.data.expectedVersion);
      if (result.kind === "stale" || result.kind === "not_configured") {
        await client.query("ROLLBACK");
        return reply.status(result.kind === "stale" ? 409 : 400).send({ code: codeFor(result.kind), message: "Mail profile could not be disabled" });
      }
      await client.query("COMMIT");
      return reply.send({ profile: result.profile });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
