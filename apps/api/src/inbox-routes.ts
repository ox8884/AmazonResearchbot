import { quoteInputSchema } from "@forge-ops/domain";
import { readMailQuoteContext } from "@forge-ops/integrations/mail/quote-source";
import { recordMailQuote } from "@forge-ops/integrations/mail/quote-record";
import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";
import { z } from "zod";
import {
  InboxCursorError,
  readInboxDetail,
  readInboxWorkspace,
} from "./inbox-read.ts";
import { linkInboxMessage } from "./inbox-link.ts";
const inboxQuoteInput = quoteInputSchema.safeExtend({ operatorEvidence: z.string().trim().max(10000).default("") });
const params = z.object({ id: z.uuid() });
const listInput = z
  .object({
    filter: z.enum(["all", "unclassified"]).default("all"),
    cursor: z.uuid().optional(),
  })
  .strict();
const linkInput = z.object({ rfqId: z.uuid() }).strict();
export function registerInboxRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: { readonly key: Buffer; readonly collectionEnabled: boolean },
): void {
  app.get("/api/inbox", async (request, reply) => {
    const input = listInput.safeParse(request.query);
    if (!input.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check inbox filter" });
    try {
      return await readInboxWorkspace(pool, {
        ...input.data,
        collectionEnabled: options.collectionEnabled,
      });
    } catch (error) {
      if (error instanceof InboxCursorError)
        return reply
          .status(400)
          .send({ code: "INVALID", message: "Check inbox cursor" });
      throw error;
    }
  });
  app.get("/api/inbox/:id", async (request, reply) => {
    const input = params.safeParse(request.params);
    if (!input.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid message" });
    const detail = await readInboxDetail(pool, options.key, input.data.id);
    if (!detail)
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Message unavailable" });
    return detail;
  });
  app.get("/api/inbox/:id/quote-preview", async (request, reply) => {
    const input = params.safeParse(request.params);
    if (!input.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Invalid reply" });
    const context = await readMailQuoteContext(
      pool,
      options.key,
      input.data.id,
    );
    if (!context)
      return reply
        .status(404)
        .send({ code: "NOT_FOUND", message: "Reply unavailable" });
    return context.preview;
  });
  app.post("/api/inbox/:id/quotes", async (request, reply) => {
    const id = params.safeParse(request.params),
      input = inboxQuoteInput.safeParse(request.body);
    if (!id.success || !input.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check quote conditions" });
    const actor: unknown = Reflect.get(request, "userId");
    if (typeof actor !== "string")
      return reply
        .status(401)
        .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const { operatorEvidence, ...quote } = input.data;
    const result = await recordMailQuote(pool, options.key, {
      mode: "manual",
      messageId: id.data.id,
      input: quote,
      actor,
      operatorEvidence,
    });
    if (result.kind === "blocked")
      return reply
        .status(
          result.code === "NOT_FOUND"
            ? 404
            : result.code === "INVALID"
              ? 400
              : 409,
        )
        .send({
          code: result.code,
          message: "The quote must match its linked supplier reply",
        });
    if (result.kind === "incomplete")
      return reply
        .status(409)
        .send({
          code: "SOURCE_UNAVAILABLE",
          message: "Quote conditions need review",
        });
    return reply
      .status(result.reused ? 200 : 201)
      .send({ quote: result.quote, reused: result.reused });
  });
  app.post("/api/inbox/:id/link", async (request, reply) => {
    const id = params.safeParse(request.params),
      input = linkInput.safeParse(request.body);
    if (!id.success || !input.success)
      return reply
        .status(400)
        .send({
          code: "INVALID",
          message: "Check the message and quote request",
        });
    const actor: unknown = Reflect.get(request, "userId");
    if (typeof actor !== "string")
      return reply
        .status(401)
        .send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    const result = await linkInboxMessage(pool, options.key, {
      messageId: id.data.id,
      rfqId: input.data.rfqId,
      actor,
    });
    if (result.kind === "error")
      return reply
        .status(result.status)
        .send({
          code: result.code,
          message: "Message could not be associated",
        });
    return { message: result.message, reused: result.reused };
  });
}
