export interface EdgeEnv {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly PUBLIC_ORIGIN?: string;
  readonly API_ORIGIN?: string;
  readonly ACCESS_CLIENT_ID?: string;
  readonly ACCESS_CLIENT_SECRET?: string;
}

type UpstreamFetch = (url: URL, init: RequestInit) => Promise<Response>;
const allowedHeaders = ["accept", "accept-language", "content-type", "cookie", "authorization", "origin", "user-agent"] as const;
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const serviceHeaders = ["cf-access-client-id", "cf-access-client-secret", "cf-access-jwt-assertion"] as const;

function httpsOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash || url.port ||
        !url.hostname.includes(".") || /^[0-9.]+$/.test(url.hostname) ||
        url.hostname.endsWith(".local") || url.hostname.endsWith(".localhost") ||
        !/^[a-z0-9.-]+$/.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function failure(status: number, code: string): Response {
  return Response.json({ error: code }, { status, headers: {
    "cache-control": "no-store", "cdn-cache-control": "no-store",
    "cloudflare-cdn-cache-control": "no-store"
  } });
}

export async function handleEdgeRequest(
  request: Request,
  env: EdgeEnv,
  fetcher: UpstreamFetch = (url, init) => fetch(url, init),
): Promise<Response> {
  const incoming = new URL(request.url);
  if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
    return env.ASSETS.fetch(request);
  }
  const publicOrigin = httpsOrigin(env.PUBLIC_ORIGIN);
  const upstream = httpsOrigin(env.API_ORIGIN);
  if (!publicOrigin || !upstream || publicOrigin.origin !== incoming.origin ||
      publicOrigin.origin === upstream.origin ||
      !env.ACCESS_CLIENT_ID?.trim() || !env.ACCESS_CLIENT_SECRET?.trim() ||
      /[^ -~]/.test(env.ACCESS_CLIENT_ID) || /[^ -~]/.test(env.ACCESS_CLIENT_SECRET)) {
    return failure(503, "EDGE_NOT_CONFIGURED");
  }
  if (!methods.has(request.method)) return failure(405, "METHOD_NOT_ALLOWED");
  const origin = request.headers.get("origin");
  if ((origin !== null && origin !== publicOrigin.origin) ||
      (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin === null)) {
    return failure(403, "ORIGIN_NOT_ALLOWED");
  }

  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  const headers = new Headers();
  for (const name of allowedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("CF-Access-Client-Id", env.ACCESS_CLIENT_ID);
  headers.set("CF-Access-Client-Secret", env.ACCESS_CLIENT_SECRET);
  try {
    const response = await fetcher(upstream, {
      method: request.method, headers, body: request.body,
      redirect: "manual", cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return failure(502, "UPSTREAM_REDIRECT_DENIED");
    }
    const responseHeaders = new Headers(response.headers);
    for (const name of serviceHeaders) responseHeaders.delete(name);
    for (const name of ["expires", "etag", "last-modified", "age", "location", "refresh"]) {
      responseHeaders.delete(name);
    }
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("cdn-cache-control", "no-store");
    responseHeaders.set("cloudflare-cdn-cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    // The HTTP boundary deliberately returns no upstream exception or credential data.
    return failure(502, "UPSTREAM_UNAVAILABLE");
  }
}

export default {
  fetch(request: Request, env: EdgeEnv): Promise<Response> {
    return handleEdgeRequest(request, env);
  },
};
