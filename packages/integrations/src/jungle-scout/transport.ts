export type JsWireResponse = { status: number; body: unknown };

export type JsTransport = {
  send: (input: { path: string; method: string; body?: unknown }) => Promise<JsWireResponse>;
};

export function denyTransport(): JsTransport {
  return {
    async send() {
      throw new Error("JS_TRANSPORT_DENIED");
    },
  };
}

export function createSimulatorTransport(origin: string, appEnv: string): JsTransport {
  if (appEnv === "production") {
    throw new Error("simulator forbidden in production");
  }
  const url = new URL(origin);
  if (url.hostname !== "127.0.0.1") {
    throw new Error("simulator host must be 127.0.0.1");
  }
  if (url.protocol !== "http:") {
    throw new Error("simulator must be http loopback");
  }
  return {
    async send(input) {
      const res = await fetch(new URL(input.path, origin), {
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
      return { status: res.status, body };
    },
  };
}

export function resolveTransport(env: NodeJS.ProcessEnv): JsTransport {
  if (env.APP_ENV === "production") return denyTransport();
  const origin = env.JS_SIMULATOR_ORIGIN;
  if (origin && origin.startsWith("http://127.0.0.1")) {
    return createSimulatorTransport(origin, env.APP_ENV ?? "development");
  }
  return denyTransport();
}
