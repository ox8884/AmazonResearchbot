import type { InboxQuotePreview } from "../../../packages/domain/src/quote-preview.ts";
import type {
  QuoteInput,
  QuoteRecord,
  SourcingView,
  SpecInput,
  SpecRecord,
} from "../../../packages/domain/src/sourcing.ts";
export class QuoteRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json();
    const code =
      typeof payload === "object" &&
      payload !== null &&
      "code" in payload &&
      typeof payload.code === "string"
        ? payload.code
        : "REQUEST_FAILED";
    throw new QuoteRequestError(response.status, code);
  }
  return response.json();
}
export const getSourcing = (candidateId: string) =>
  request<SourcingView>(
    `/api/candidates/${encodeURIComponent(candidateId)}/sourcing`,
  );
export const createSpec = (candidateId: string, body: SpecInput) =>
  request<SpecRecord>(
    `/api/candidates/${encodeURIComponent(candidateId)}/specs`,
    body,
  );
export const createQuote = (candidateId: string, body: QuoteInput) =>
  request<QuoteRecord>(
    `/api/candidates/${encodeURIComponent(candidateId)}/quotes`,
    body,
  );

export const getInboxQuotePreview = (id: string) =>
  request<InboxQuotePreview>(
    `/api/inbox/${encodeURIComponent(id)}/quote-preview`,
  );
export const createInboxQuote = async (
  id: string,
  body: QuoteInput,
  operatorEvidence = "",
): Promise<QuoteRecord> => {
  const result = await request<{ quote: QuoteRecord; reused: boolean }>(
    `/api/inbox/${encodeURIComponent(id)}/quotes`,
    { ...body, operatorEvidence },
  );
  return result.quote;
};
