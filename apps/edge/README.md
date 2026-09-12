# Forge Kitchen Ops edge

This Worker serves the existing React build and proxies only /api and /api/* to one configured HTTPS origin. It does not authenticate business users: the API session and six-digit 2FA flow still apply.

Local checks from repository root:

- pnpm exec tsc -p apps/edge/tsconfig.json
- pnpm exec tsx scripts/verify-edge-proxy.mjs
- pnpm --filter @forge-ops/web build

The HTTP test uses a loopback origin with synthetic credentials. It covers the real exported Worker entrypoint, POST streaming, status and multiple Set-Cookie headers. It does not verify Cloudflare runtime, Access, Tunnel or deployed login.

## Deployment prerequisites, not executed

After separate deployment approval, set PUBLIC_ORIGIN to the UI's exact HTTPS origin and API_ORIGIN to the Access-protected Tunnel hostname. Both must be origin-only URLs, with no credentials, port, query or path. Configure Access with a Service Auth policy restricted to the issued service token. Bind ACCESS_CLIENT_ID and ACCESS_CLIENT_SECRET as Worker secrets; never put them in vars, source files or a web build. Local .dev.vars and variants are ignored and rejected by the publication scanner. No real credentials are provided here.

Build apps/web before packaging assets. The supplied config has no routes and workers_dev disabled; no site is published by the local checks. Wrangler is not installed by this change.

API responses and errors are no-store. Redirects are rejected, never followed. Only selected request headers reach the configured origin; browser-supplied Access and forwarding headers are discarded. Upstream response Access headers are removed and API logs redact service credentials. Request bodies and response bodies remain streams. No retry is performed. The upstream request has a 60-second deadline and follows client cancellation.

Static routes use SPA fallback; /api and /api/* run the Worker first. Static assets contain no business data. The origin API must remain reachable only via the protected Tunnel and keep its own session checks, request limits, approved public auth URL and trusted-origin configuration. Complete real login/2FA, upload and cookie checks on Cloudflare before declaring deployment accepted.

Official references:
- https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- https://developers.cloudflare.com/workers/runtime-apis/request/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
