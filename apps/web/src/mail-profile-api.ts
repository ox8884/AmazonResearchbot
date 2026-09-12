import type {
  MailProfileActivation,
  MailProfileConfig,
  MailProfileSafeView,
} from "../../../packages/domain/src/mail-profile.ts";

export type MailProfileSaveInput = MailProfileConfig & {
  readonly expectedVersion?: number;
  readonly password?: string;
};

export type MailProfileApproval = {
  readonly id: string;
  readonly payload: MailProfileActivation;
};

export class MailProfileRequestError extends Error {
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

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
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
    const payload: unknown = await response.json();
    const code =
      typeof payload === "object" &&
      payload !== null &&
      "code" in payload &&
      typeof payload.code === "string"
        ? payload.code
        : "REQUEST_FAILED";
    throw new MailProfileRequestError(response.status, code);
  }
  return response.json();
}

export async function getMailProfile(): Promise<MailProfileSafeView> {
  const response = await request<{ readonly profile: MailProfileSafeView }>(
    "/api/mail-profile",
  );
  return response.profile;
}

export async function saveMailProfile(
  input: MailProfileSaveInput,
): Promise<MailProfileSafeView> {
  const response = await request<{ readonly profile: MailProfileSafeView }>(
    "/api/mail-profile",
    { method: "POST", body: input },
  );
  return response.profile;
}

export async function requestMailProfileActivation(
  expectedVersion: number,
): Promise<MailProfileSafeView> {
  const response = await request<{
    readonly approvalId: string;
    readonly profile: MailProfileSafeView;
  }>("/api/mail-profile/activation-proposals", {
    method: "POST",
    body: { expectedVersion },
  });
  return response.profile;
}

export async function pendingMailProfileApprovals(): Promise<
  readonly MailProfileApproval[]
> {
  const response = await request<{
    readonly approvals: readonly {
      readonly id: string;
      readonly kind: string;
      readonly payload: MailProfileActivation | null;
    }[];
  }>("/api/approvals?kind=provider_activation&status=pending");
  return response.approvals.flatMap((approval) =>
    approval.kind === "provider_activation" &&
    approval.payload?.target === "mail_profile"
      ? [{ id: approval.id, payload: approval.payload }]
      : [],
  );
}

export async function decideMailProfileApproval(
  approvalId: string,
  decision: "approve" | "reject",
): Promise<void> {
  await request<unknown>(
    `/api/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    { method: "POST", body: {} },
  );
}

export async function disableMailProfile(
  expectedVersion: number,
): Promise<MailProfileSafeView> {
  const response = await request<{ readonly profile: MailProfileSafeView }>(
    "/api/mail-profile/disable",
    { method: "POST", body: { expectedVersion } },
  );
  return response.profile;
}
