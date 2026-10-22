import type { InboxQuotePreview } from "../../../packages/domain/src/quote-preview.ts";
import type {
  QuoteInput,
  QuoteRecord,
  SourcingView,
  SpecInput,
  SpecRecord,
} from "../../../packages/domain/src/sourcing.ts";
import { requestJson } from "./api.ts";
export class QuoteRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const request = <T>(path: string, body?: unknown) =>
  requestJson<T>(path, QuoteRequestError, { body });
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
