import { isIP } from "node:net";
import {
  customAiActivationRequestSchema,
  customAiProfileWriteSchema,
} from "@forge-ops/domain";
import type { Pool } from "@forge-ops/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createCustomAiActivationProposal,
  disableCustomAiProfile,
  saveCustomAiProfile,
} from "./ai-profile-store.ts";
import {
  customAiProfileView,
  readCustomAiProfiles,
} from "./ai-profile-core.ts";

const profileParamsSchema = z.object({ id: z.uuid() }).strict();

function actorId(request: FastifyRequest): string | undefined {
  return "userId" in request && typeof request.userId === "string"
    ? request.userId
    : undefined;
}

function hasSafeProviderOrigin(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    !isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
    url.hostname.includes(".") &&
    !/\.(localhost|local|internal)$/.test(url.hostname)
  );
}

function sendProfileFailure(
  reply: FastifyReply,
  kind: "not_found" | "stale" | "config_required",
): FastifyReply {
  switch (kind) {
    case "not_found":
      return reply.status(404).send({ code: "NOT_FOUND" });
    case "stale":
      return reply.status(409).send({ code: "PROFILE_CHANGED" });
    case "config_required":
      return reply.status(400).send({ code: "PROVIDER_CONFIG_REQUIRED" });
  }
}
export function registerCustomAiRoutes(
  app: FastifyInstance,
  pool: Pool,
  key: Buffer,
) : void {
  app.get("/api/custom-ai", async () => {
    const profiles = await readCustomAiProfiles(pool);
    return { profiles: profiles.map(customAiProfileView) };
  });

  app.post("/api/custom-ai", async (request, reply) => {
    const parsed = customAiProfileWriteSchema.safeParse(request.body);
    if (!parsed.success || !hasSafeProviderOrigin(parsed.data.baseUrl))
      return reply.status(400).send({ code: "INVALID_CUSTOM_AI" });
    const actor = actorId(request);
    if (!actor) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await saveCustomAiProfile(client, parsed.data, key, actor);
      if (result.kind === "not_found" || result.kind === "stale") {
        await client.query("ROLLBACK");
        return sendProfileFailure(reply, result.kind);
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

  app.post("/api/custom-ai/:id/activation-proposals", async (request, reply) => {
    const params = profileParamsSchema.safeParse(request.params);
    const body = customAiActivationRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success)
      return reply.status(400).send({ code: "INVALID_CUSTOM_AI" });
    const actor = actorId(request);
    if (!actor) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await createCustomAiActivationProposal(
        client,
        actor,
        params.data.id,
        body.data.version,
        body.data.productEvidenceScope,
      );
      if (result.kind === "created" || result.kind === "reused") {
        await client.query("COMMIT");
        return reply.status(result.kind === "created" ? 201 : 200).send({
          approvalId: result.approvalId,
          reused: result.kind === "reused",
          profile: result.profile,
        });
      }
      await client.query("ROLLBACK");
      return sendProfileFailure(reply, result.kind);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/custom-ai/:id/disable", async (request, reply) => {
    const params = profileParamsSchema.safeParse(request.params);
    const body = customAiActivationRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success)
      return reply.status(400).send({ code: "INVALID_CUSTOM_AI" });
    const actor = actorId(request);
    if (!actor) return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await disableCustomAiProfile(
        client,
        actor,
        params.data.id,
        body.data.version,
      );
      if (result.kind === "disabled") {
        await client.query("COMMIT");
        return reply.send({ profile: result.profile });
      }
      await client.query("ROLLBACK");
      return sendProfileFailure(reply, result.kind);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
