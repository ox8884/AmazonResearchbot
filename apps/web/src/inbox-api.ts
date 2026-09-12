import type {
  InboxMessageDetail,
  InboxMessageSummary,
  InboxWorkspace,
} from "../../../packages/domain/src/inbox.ts";

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

type RequestOptions = {
  readonly method?: "POST";
  readonly body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "include",
    headers:
      options.body === undefined ? {} : { "content-type": "application/json" },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code =
      typeof payload === "object" &&
      payload !== null &&
      "code" in payload &&
      typeof payload.code === "string"
        ? payload.code
        : "REQUEST_FAILED";
    throw new InboxRequestError(response.status, code);
  }
  return response.json();
}

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
