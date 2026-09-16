import { z } from "zod";
import { pinnedJsonRequest, resolveApprovedTarget } from "@forge-ops/security";
import type { MailReceipt, MailTransport } from "./transport.ts";

const COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp";
const rpcEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const toolEnvelopeSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
});
const gmailSendResultSchema = z.object({
  successful: z.literal(true),
  data: z.object({ id: z.string().min(1), threadId: z.string().min(1).optional() }),
});
const multiExecuteResultSchema = z.object({
  successful: z.literal(true),
  error: z.string().nullish(),
  data: z.object({
    results: z.tuple([
      z.union([
          z.object({ response: gmailSendResultSchema }),
          z.object({ result: gmailSendResultSchema }),
          gmailSendResultSchema,
      ]),
    ]),
  }),
});

export type ComposioMcpWire = (input: {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}) => Promise<{
  readonly status: number;
  readonly body: unknown;
  readonly mcpSessionId?: string;
}>;

export type ComposioGmailAccess = {
  readonly accountId: string;
  readonly recipient: string;
  readonly isCurrent: () => Promise<boolean>;
};

class ComposioMailError extends Error {
  readonly name = "ComposioMailError";
  constructor(readonly code: string, readonly outcomeUnknown: boolean) {
    super(code);
  }
}

async function realWire(input: Parameters<ComposioMcpWire>[0]) {
  const resolved = await resolveApprovedTarget(COMPOSIO_MCP_URL, { "connect.composio.dev": true });
  if (!resolved.ok)
    throw new ComposioMailError("COMPOSIO_UNREACHABLE", false);
  return pinnedJsonRequest(resolved.target, { method: "POST", ...input });
}

function rpcResult(body: unknown, id: number): unknown {
  const candidates: unknown[] = [];
  if (typeof body !== "string") candidates.push(body);
  else {
    try {
      candidates.push(JSON.parse(body));
    } catch {
      for (const event of body.replace(/\r\n/g, "\n").split("\n\n")) {
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try {
          candidates.push(JSON.parse(data));
        } catch {
          throw new ComposioMailError("COMPOSIO_RESPONSE_INVALID", true);
        }
      }
    }
  }
  for (const candidate of candidates) {
    const parsed = rpcEnvelopeSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.id !== id) continue;
    if (parsed.data.error !== undefined)
      throw new ComposioMailError("COMPOSIO_RPC_ERROR", false);
    return parsed.data.result;
  }
  throw new ComposioMailError("COMPOSIO_RESPONSE_INVALID", true);
}

function toolData(value: unknown): unknown {
  const parsed = toolEnvelopeSchema.safeParse(value);
  if (!parsed.success)
    throw new ComposioMailError("COMPOSIO_RESPONSE_INVALID", true);
  if (parsed.data.isError)
    throw new ComposioMailError("COMPOSIO_TOOL_FAILED", false);
  if (parsed.data.structuredContent !== undefined)
    return parsed.data.structuredContent;
  const text = parsed.data.content?.filter(
    (part) => part.type === "text" && part.text,
  );
  if (text?.length !== 1 || !text[0]?.text)
    throw new ComposioMailError("COMPOSIO_RESPONSE_INVALID", true);
  try {
    return JSON.parse(text[0].text);
  } catch {
    throw new ComposioMailError("COMPOSIO_RESPONSE_INVALID", true);
  }
}

function gmailReceipt(raw: unknown): MailReceipt {
  const parsed = multiExecuteResultSchema.safeParse(raw);
  if (!parsed.success || parsed.data.error)
    return { kind: "not_sent", reason: "COMPOSIO_TOOL_FAILED" };
  const item = parsed.data.data.results[0];
  const result =
    "response" in item ? item.response : "result" in item ? item.result : item;
  return {
    kind: "sent",
    messageId: result.data.id,
    receipt: JSON.stringify({
      transport: "composio-gmail",
      messageId: result.data.id,
      ...(result.data.threadId ? { threadId: result.data.threadId } : {}),
    }),
  };
}

export function createComposioGmailTransport(
  apiKey: string,
  access: ComposioGmailAccess,
  wire: ComposioMcpWire = realWire,
): MailTransport {
  const expectedRecipient = access.recipient.toLowerCase();
  return {
    name: "composio-gmail",
    authorize: async (payload) => {
      if (payload.recipient.toLowerCase() !== expectedRecipient)
        return { allowed: false, reason: "COMPOSIO_RECIPIENT_CHANGED" };
      return (await access.isCurrent())
        ? { allowed: true }
        : { allowed: false, reason: "COMPOSIO_CONNECTION_CHANGED" };
    },
    send: async (payload) => {
      if (payload.recipient.toLowerCase() !== expectedRecipient)
        return { kind: "not_sent", reason: "COMPOSIO_RECIPIENT_CHANGED" };
      if (!(await access.isCurrent()))
        return { kind: "not_sent", reason: "COMPOSIO_CONNECTION_CHANGED" };
      const headers: Record<string, string> = {
        "x-consumer-api-key": apiKey.trim(),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };
      let submitted = false;
      const call = async (method: string, params: unknown, id?: number) => {
        const response = await wire({
          headers: { ...headers },
          body: JSON.stringify({
            jsonrpc: "2.0",
            ...(id === undefined ? {} : { id }),
            method,
            params,
          }),
        });
        if (response.status < 200 || response.status >= 300)
          throw new ComposioMailError(
            response.status === 401 || response.status === 403
              ? "COMPOSIO_CREDENTIAL_REJECTED"
              : "COMPOSIO_REQUEST_FAILED",
            response.status >= 500,
          );
        if (response.mcpSessionId)
          headers["mcp-session-id"] = response.mcpSessionId;
        return id === undefined ? null : rpcResult(response.body, id);
      };
      try {
        const initialized = z
          .object({ protocolVersion: z.literal("2025-03-26") })
          .safeParse(
            await call(
              "initialize",
              {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: {
                  name: "forge-kitchen-ops",
                  version: "1.0.0",
                },
              },
              1,
            ),
          );
        if (!initialized.success)
          throw new ComposioMailError(
            "COMPOSIO_PROTOCOL_UNSUPPORTED",
            false,
          );
        headers["mcp-protocol-version"] = initialized.data.protocolVersion;
        await call("notifications/initialized", {});
        submitted = true;
        const raw = toolData(
          await call(
            "tools/call",
            {
              name: "COMPOSIO_MULTI_EXECUTE_TOOL",
              arguments: {
                tools: [
                  {
                    tool_slug: "GMAIL_SEND_EMAIL",
                    account: access.accountId,
                    arguments: {
                      recipient_email: payload.recipient,
                      subject: payload.subject,
                      body: payload.body,
                      is_html: false,
                      user_id: "me",
                    },
                  },
                ],
                sync_response_to_workbench: false,
                thought: "Send the approved Forge Kitchen Ops morning summary.",
                current_step: "SENDING_SUMMARY",
                current_step_metric: "1/1 email",
              },
            },
            2,
          ),
        );
        return gmailReceipt(raw);
      } catch (error) {
        if (error instanceof ComposioMailError)
          return error.outcomeUnknown || submitted
            ? { kind: "unknown", reason: "COMPOSIO_SEND_OUTCOME_UNKNOWN" }
            : { kind: "not_sent", reason: error.code };
        return submitted
          ? { kind: "unknown", reason: "COMPOSIO_SEND_OUTCOME_UNKNOWN" }
          : { kind: "not_sent", reason: "COMPOSIO_REQUEST_FAILED" };
      }
    },
  };
}
