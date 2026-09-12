import { createOfficialTransport } from "./official-transport.ts";
export type JsWireResponse = { readonly status: number; readonly body: unknown; readonly retryAfter: string | null };

export type JsTransport = ({ readonly kind: "disabled" } | {
  readonly kind: "ready";
  send: (input: { path: string; method: string; body?: unknown }) => Promise<JsWireResponse>;
}) & { readonly accountScope?: string; readonly credentialRevision?: string };

export function denyTransport(): JsTransport {
  return { kind: "disabled" };
}

export function createSimulatorTransport(origin: string, appEnv: string): JsTransport {
  if (appEnv !== "development") {
    throw new Error("simulator requires development environment");
  }
  const url = new URL(origin);
  if (url.hostname !== "127.0.0.1") {
    throw new Error("simulator host must be 127.0.0.1");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("simulator origin must not contain credentials or a path");
  }
  if (url.protocol !== "http:") {
    throw new Error("simulator must be http loopback");
  }
  return {
    kind: "ready",
    async send(input) {
      const target = new URL(input.path, url);
      if (target.origin !== url.origin || target.username || target.password || target.hash)
        throw new Error("SIMULATOR_TARGET_DENIED");
      const res = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
        method: input.method,
        headers: { "content-type": "application/json" },
        body: input.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body, retryAfter: res.headers.get("retry-after") };
    },
  };
}

export function resolveTransport(env: NodeJS.ProcessEnv): JsTransport {
  if (env.APP_ENV !== "development") return denyTransport();
  if (env.JS_TRANSPORT === "official") {
    const official = createOfficialTransport({ keyName: env.JS_API_KEY_NAME, apiKey: env.JS_API_KEY, accountScope: env.JS_ACCOUNT_SCOPE });
    return env.JS_SIMULATOR_ORIGIN
      ? { kind: "disabled", accountScope: official.accountScope }
      : official;
  }
  if (env.JS_TRANSPORT && env.JS_TRANSPORT !== "simulator") return denyTransport();
  const origin = env.JS_SIMULATOR_ORIGIN;
  if (origin && origin.startsWith("http://127.0.0.1")) {
    return createSimulatorTransport(origin, env.APP_ENV);
  }
  return denyTransport();
}
