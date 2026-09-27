import { HttpBoundaryError, pinnedJsonRequest, resolveApprovedTarget } from "@forge-ops/security";

// TypeSafe System One: typed judgments with probabilities, no generated text.
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const ALLOWED = { "api.typesafe.ai": true } as const;

export type JevQuestion =
  | { readonly type: "noul"; readonly instructions: string }
  | { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> };
export type JevRequest = { readonly state: Readonly<Record<string, unknown>>; readonly questions: Readonly<Record<string, JevQuestion>> };
export type JevResult = { readonly model: string; readonly answers: Readonly<Record<string, unknown>>; readonly inputTokens: number; readonly latencyMs: number };

// Transient failures (rate limit, server, network) should be retried on a later tick; anything else is final.
export class JevError extends Error {
  constructor(readonly code: string, readonly transient: boolean) { super(code); }
}

export async function askJev(apiKey: string, request: JevRequest): Promise<JevResult> {
  const target = await resolveApprovedTarget(ENDPOINT, ALLOWED);
  if (!target.ok) throw new JevError("JEV_" + target.code, true);
  const started = Date.now();
  let response;
  try {
    response = await pinnedJsonRequest(target.target, {
      method: "POST",
      headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", ...request }),
    });
  } catch (error) {
    throw new JevError(error instanceof HttpBoundaryError ? "JEV_" + error.code : "JEV_NETWORK", true);
  }
  if (response.status !== 200)
    throw new JevError("JEV_HTTP_" + response.status, response.status === 429 || response.status >= 500);
  const body = response.body as { model?: unknown; answers?: unknown; usage?: { input_tokens?: unknown } } | null;
  if (!body || typeof body.answers !== "object" || body.answers === null) throw new JevError("JEV_INVALID_RESPONSE", false);
  return {
    model: typeof body.model === "string" ? body.model : "unknown",
    answers: body.answers as Record<string, unknown>,
    inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0,
    latencyMs: Date.now() - started,
  };
}
