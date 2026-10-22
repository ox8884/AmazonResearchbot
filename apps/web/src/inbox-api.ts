import type {
  InboxMessageDetail,
  InboxMessageSummary,
  InboxWorkspace,
} from "../../../packages/domain/src/inbox.ts";
import { requestJson } from "./api.ts";

export type InboxFilter = "all" | "unclassified";

export type InboxLinkResult = {
  readonly message: InboxMessageSummary;
  readonly reused: boolean;
};

export class InboxRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const request = <T>(
  path: string,
  options?: { readonly method?: "POST"; readonly body?: unknown },
) => requestJson<T>(path, InboxRequestError, options);

export async function getInboxWorkspace(
  filter: InboxFilter,
  cursor: string | null,
): Promise<InboxWorkspace> {
  const parameters = new URLSearchParams({ filter });
  if (cursor) parameters.set("cursor", cursor);
  return request<InboxWorkspace>(`/api/inbox?${parameters.toString()}`);
}

export function getInboxMessage(id: string): Promise<InboxMessageDetail> {
  return request<InboxMessageDetail>(`/api/inbox/${encodeURIComponent(id)}`);
}

export function linkInboxMessage(
  id: string,
  rfqId: string,
): Promise<InboxLinkResult> {
  return request<InboxLinkResult>(`/api/inbox/${encodeURIComponent(id)}/link`, {
    method: "POST",
    body: { rfqId },
  });
}
