import { validateHeaderValue } from "node:http";
import { pinnedJsonRequest, resolveApprovedTarget, type HostResolver } from "@forge-ops/security";
export type AiWireInput = {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly messages: readonly { readonly role: "system" | "user"; readonly content: string }[];
};
export type AiWireResult =
  | { readonly kind: "response"; readonly status: number; readonly body: unknown }
  | { readonly kind: "not_sent"; readonly code: string }
  | { readonly kind: "unknown"; readonly code: string };
export type AiTransport =
  | { readonly kind: "disabled" }
  | { readonly kind: "ready"; readonly send: (input: AiWireInput) => Promise<AiWireResult> };
type Dependencies = { readonly resolver?: HostResolver; readonly request?: typeof pinnedJsonRequest };

// The caller supplies only an approved profile after reserving its request budget.
export function createAiTransport(enabled: boolean, dependencies: Dependencies = {}): AiTransport {
  if (!enabled) return { kind: "disabled" };
  return { kind: "ready", send: async input => {
    let url: URL;
    try { url = new URL(input.baseUrl); }
    catch { return { kind: "not_sent", code: "PROVIDER_URL_INVALID" }; }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443"))
      return { kind: "not_sent", code: "PROVIDER_URL_INVALID" };
    if (!input.model.trim() || input.model.length > 200 || !input.apiKey.trim() || input.apiKey.length > 8000 || /[\x00-\x1f\x7f]/.test(input.apiKey))
      return { kind: "not_sent", code: "PROVIDER_CREDENTIAL_INVALID" };
    try { validateHeaderValue("authorization", `Bearer ${input.apiKey}`); }
    catch { return { kind: "not_sent", code: "PROVIDER_CREDENTIAL_INVALID" }; }
    if (!Number.isSafeInteger(input.maxInputTokens) || input.maxInputTokens < 1 || input.maxInputTokens > 131072 ||
        !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 16384 ||
        input.messages.length < 1 || input.messages.length > 8 ||
        input.messages.some(message => !["system", "user"].includes(message.role) || !message.content.trim()))
      return { kind: "not_sent", code: "PROVIDER_INPUT_INVALID" };
    const body = JSON.stringify({ model: input.model, messages: input.messages, max_tokens: input.maxOutputTokens, stream: false });
    // This is a conservative byte limit, not a measurement of billed input tokens.
    if (Buffer.byteLength(body, "utf8") > input.maxInputTokens)
      return { kind: "not_sent", code: "PROVIDER_INPUT_TOO_LARGE" };
    url.pathname = url.pathname.replace(/\/+$/, "") + "/chat/completions";
    const target = await resolveApprovedTarget(url.href, { [url.hostname]: true }, dependencies.resolver);
    if (!target.ok) return { kind: "not_sent", code: target.code };
    try {
      const response = await (dependencies.request ?? pinnedJsonRequest)(target.target, {
        method: "POST", headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" }, body,
      });
      return { kind: "response", status: response.status, body: response.body };
    } catch {
      return { kind: "unknown", code: "PROVIDER_OUTCOME_UNKNOWN" };
    }
  } };
}
