import { z } from "zod";
import { resolveApprovedTarget, pinnedJsonRequest } from "@forge-ops/security";
export class ComposioError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp";
export type McpWire = (input: {
  headers: Readonly<Record<string, string>>;
  body: string;
}) => Promise<{ status: number; body: unknown; mcpSessionId?: string }>;
const accountSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.string(),
  user_info: z.object({ emailAddress: z.email().optional() }).nullish(),
});
export type GmailAccounts = {
  accounts: z.infer<typeof accountSchema>[];
  redirectUrl: string | null;
  sessionId: string;
};
export type ComposioRequest = (
  action: "list" | "add",
) => Promise<GmailAccounts>;
async function realWire(input: Parameters<McpWire>[0]) {
  const target = await resolveApprovedTarget(COMPOSIO_MCP_URL, {
    "connect.composio.dev": true,
  });
  if (!target.ok) throw new ComposioError("COMPOSIO_UNREACHABLE");
  return pinnedJsonRequest(target.target, { method: "POST", ...input });
}
function rpcResult(body: unknown, id: number): unknown {
  let candidates: unknown[] = [body];
  if (typeof body === "string") {
    try {
      candidates = [JSON.parse(body)];
    } catch {
      candidates = [];
      for (const event of body.replace(/\r\n/g, "\n").split("\n\n")) {
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) {
          try {
            candidates.push(JSON.parse(data));
          } catch {
            throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
          }
        }
      }
    }
  }
  for (const value of candidates) {
    const p = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.number(),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
      })
      .safeParse(value);
    if (p.success && p.data.id === id) {
      if (p.data.error !== undefined)
        throw new ComposioError("COMPOSIO_RPC_ERROR");
      return p.data.result;
    }
  }
  throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
}
function linkUrl(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    !["connect.composio.dev", "app.composio.dev"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    !/^\/link\/[A-Za-z0-9_-]+$/.test(u.pathname)
  )
    throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
  return u.toString();
}
function toolData(value: unknown): unknown {
  const p = z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    })
    .safeParse(value);
  if (!p.success || p.data.isError)
    throw new ComposioError("COMPOSIO_TOOL_FAILED");
  if (p.data.structuredContent !== undefined) return p.data.structuredContent;
  const text = p.data.content?.filter((x) => x.type === "text" && x.text);
  if (text?.length !== 1 || !text[0]?.text)
    throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
  try {
    return JSON.parse(text[0].text);
  } catch {
    throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
  }
}
export function createComposioRequest(
  apiKey: string,
  wire: McpWire = realWire,
): ComposioRequest {
  return async (action) => {
    if (action !== "list" && action !== "add")
      throw new ComposioError("COMPOSIO_ACTION_REJECTED");
    const headers: Record<string, string> = {
      "x-consumer-api-key": apiKey.trim(),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    async function send(method: string, params: unknown, id?: number) {
      const r = await wire({
        headers: { ...headers },
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(id === undefined ? {} : { id }),
          method,
          params,
        }),
      });
      if (r.status < 200 || r.status >= 300)
        throw new ComposioError(
          r.status === 401 || r.status === 403
            ? "COMPOSIO_CREDENTIAL_REJECTED"
            : "COMPOSIO_REQUEST_FAILED",
        );
      if (r.mcpSessionId) headers["mcp-session-id"] = r.mcpSessionId;
      return id === undefined ? null : rpcResult(r.body, id);
    }
    const init = z
      .object({ protocolVersion: z.literal("2025-03-26") })
      .safeParse(
        await send(
          "initialize",
          {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "forge-kitchen-ops", version: "1.0.0" },
          },
          1,
        ),
      );
    if (!init.success) throw new ComposioError("COMPOSIO_PROTOCOL_UNSUPPORTED");
    headers["mcp-protocol-version"] = init.data.protocolVersion;
    await send("notifications/initialized", {});
    const raw = toolData(
      await send(
        "tools/call",
        {
          name: "COMPOSIO_MANAGE_CONNECTIONS",
          arguments: { toolkits: [{ name: "gmail", action }] },
        },
        2,
      ),
    );
    const parsed = z
      .object({
        successful: z.literal(true),
        error: z.string().nullish(),
        data: z.object({
          results: z.object({
            gmail: z.object({
              accounts: z.array(accountSchema).optional(),
              redirect_url: z.url().optional(),
            }),
          }),
        }),
      })
      .safeParse(raw);
    if (!parsed.success || parsed.data.error)
      throw new ComposioError("COMPOSIO_TOOL_FAILED");
    const gmail = parsed.data.data.results.gmail;
    if (action === "list" && !gmail.accounts)
      throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
    if (action === "add" && !gmail.redirect_url)
      throw new ComposioError("COMPOSIO_RESPONSE_INVALID");
    return {
      accounts: gmail.accounts ?? [],
      redirectUrl: gmail.redirect_url ? linkUrl(gmail.redirect_url) : null,
      sessionId: headers["mcp-session-id"] ?? "stateless",
    };
  };
}
