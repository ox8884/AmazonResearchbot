import { createHash } from "node:crypto";
import { validateHeaderValue } from "node:http";
import {
  pinnedJsonRequest,
  resolveApprovedTarget,
  type HostResolver,
  type JsonRequest,
} from "@forge-ops/security";
import { JS_BASE, JS_ENDPOINTS } from "./endpoints.ts";
import { JUNGLE_SCOUT_HEADER_CONTRACT } from "./requests.ts";
import type { JsTransport } from "./transport.ts";

type OfficialCredentials = {
  readonly keyName?: string;
  readonly apiKey?: string;
  readonly accountScope?: string;
};
type OfficialDependencies = {
  readonly resolver?: HostResolver;
  readonly request?: typeof pinnedJsonRequest;
};
type WireInput = { path: string; method: string; body?: unknown };
const HOSTS = { "developer.junglescout.com": true } as const;

function headerValue(value: string | undefined): value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    return false;
  try {
    validateHeaderValue("authorization", value);
    return true;
  } catch {
    return false;
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function approvedRequest(input: WireInput): {
  url: string;
  method: "GET" | "POST";
  body?: string;
} {
  if (!input.path.startsWith("/api/") || /[\r\n\0]/.test(input.path))
    throw new Error("JS_REQUEST_REJECTED");
  const url = new URL(input.path, JS_BASE);
  const spec = Object.values(JS_ENDPOINTS).find(
    (endpoint) =>
      endpoint.path === url.pathname && endpoint.method === input.method,
  );
  const markets = [...url.searchParams.entries()].filter(
    ([name]) => name.toLowerCase() === "marketplace",
  );
  if (
    url.origin !== JS_BASE ||
    url.username ||
    url.password ||
    url.hash ||
    !spec ||
    markets.length !== 1 ||
    markets[0]?.[0] !== "marketplace" ||
    markets[0]?.[1] !== "us"
  )
    throw new Error("JS_REQUEST_REJECTED");
  if (spec.method === "GET") {
    if (input.body !== undefined) throw new Error("JS_REQUEST_REJECTED");
    return { url: url.href, method: spec.method };
  }
  if (
    !record(input.body) ||
    !record(input.body.data) ||
    input.body.data.type !== spec.type ||
    !record(input.body.data.attributes)
  )
    throw new Error("JS_REQUEST_REJECTED");
  let body: string;
  try {
    body = JSON.stringify(input.body);
  } catch {
    throw new Error("JS_REQUEST_REJECTED");
  }
  if (Buffer.byteLength(body) > 4 * 1024 * 1024)
    throw new Error("JS_REQUEST_REJECTED");
  return { url: url.href, method: spec.method, body };
}

export function createOfficialTransport(
  credentials: OfficialCredentials,
  dependencies: OfficialDependencies = {},
): JsTransport {
  const scope = credentials.accountScope;
  const validScope =
    typeof scope === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(scope);
  const accountScope = validScope
    ? "official:" + createHash("sha256").update(scope).digest("hex")
    : "official:unconfigured";
  const { keyName, apiKey } = credentials;
  if (
    !validScope ||
    !headerValue(keyName) ||
    keyName.includes(":") ||
    !headerValue(apiKey)
  )
    return { kind: "disabled", accountScope };
  return {
    kind: "ready",
    accountScope,
    credentialRevision: createHash("sha256")
      .update(`${keyName}:${apiKey}`)
      .digest("hex"),
    async send(input) {
      const checked = approvedRequest(input);
      const decision = await resolveApprovedTarget(
        checked.url,
        HOSTS,
        dependencies.resolver,
      );
      if (!decision.ok) throw new Error(decision.code);
      const request: JsonRequest = {
        method: checked.method,
        headers: {
          authorization: `${keyName}:${apiKey}`,
          "x-api-type": JUNGLE_SCOUT_HEADER_CONTRACT.xApiType,
          accept: JUNGLE_SCOUT_HEADER_CONTRACT.accept,
          "content-type": JUNGLE_SCOUT_HEADER_CONTRACT.contentType,
        },
        ...(checked.body !== undefined ? { body: checked.body } : {}),
      };
      const result = await (dependencies.request ?? pinnedJsonRequest)(
        decision.target,
        request,
      );
      return {
        status: result.status,
        body: result.body,
        retryAfter: result.retryAfter,
      };
    },
  };
}
