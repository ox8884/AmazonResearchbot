import type { CandidateValidationView } from "../../../packages/domain/src/validation-view.ts";
import type { CsvMapping } from "../../../packages/domain/src/csv-import.ts";
export type NextAction = {
  kind: "automatic" | "approval" | "waiting";
  label: string;
  target: string;
};

export type CandidateView = {
  id: string;
  keyword: string;
  stage: string;
  stageLabel: string;
  evidenceSummary: string;
  unknowns: string[];
  nextAction: NextAction;
  blockedReason: string | null;
};

export type Session = {
  user: { id: string; email: string; twoFactorEnabled: boolean };
};

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

export async function getSession(): Promise<Session | null> {
  const res = await request("/api/session");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("session");
  return (await res.json()) as Session;
}

export type AuthResult = {
  twoFactorRedirect?: boolean;
  code?: string;
  message?: string;
};

export async function signIn(
  email: string,
  password: string,
): Promise<AuthResult> {
  const res = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function enableTotp(
  password: string,
): Promise<{ totpURI?: string; backupCodes?: string[] }> {
  const res = await request("/api/auth/two-factor/enable", {
    method: "POST",
    body: JSON.stringify({ password, method: "totp" }),
  });
  return res.json();
}

export async function verifyTotp(
  code: string,
  trustDevice = false,
): Promise<AuthResult> {
  const res = await request("/api/auth/two-factor/verify-totp", {
    method: "POST",
    body: JSON.stringify({ code, trustDevice }),
  });
  return res.json();
}

export async function listCandidates(
  language = "ko",
): Promise<CandidateView[]> {
  const res = await request("/api/candidates", {
    headers: { "accept-language": language },
  });
  if (!res.ok) throw new Error("candidates");
  const body = (await res.json()) as { candidates: CandidateView[] };
  return body.candidates;
}

export type Evidence = {
  field: string;
  kind: string;
  value_numeric: string | null;
  value_text: string | null;
  reason: string | null;
  observed_at: string | null;
};

export async function getCandidate(
  id: string,
  language = "ko",
): Promise<{
  candidate: CandidateView;
  evidence: Evidence[];
  validation: CandidateValidationView;
}> {
  const res = await request(`/api/candidates/${encodeURIComponent(id)}`, {
    headers: { "accept-language": language },
  });
  if (!res.ok) throw new Error("candidate");
  return res.json();
}

export async function uploadCsv(
  file: File,
  searchRunId?: string,
  review?: { mapping: CsvMapping; expectedSha256: string },
): Promise<{
  status: number;
  body: {
    reused?: boolean;
    created?: number;
    code?: string;
    rows: readonly { rowNumber: number; error: string }[];
  };
}> {
  const body = new FormData();
  if (review) {
    body.append("mapping", JSON.stringify(review.mapping));
    body.append("expectedSha256", review.expectedSha256);
  }
  body.append("file", file);
  const res = await fetch(
    searchRunId
      ? `/api/imports?searchRunId=${encodeURIComponent(searchRunId)}`
      : "/api/imports",
    {
      method: "POST",
      credentials: "include",
      body,
    },
  );
  const payload: unknown = await res.json();
  const rows: { rowNumber: number; error: string }[] = [];
  if (typeof payload !== "object" || payload === null)
    return { status: res.status, body: { rows } };
  if ("rows" in payload && Array.isArray(payload.rows)) {
    const candidates: readonly unknown[] = payload.rows;
    for (const row of candidates) {
      if (
        typeof row === "object" &&
        row !== null &&
        "rowNumber" in row &&
        "error" in row &&
        typeof row.rowNumber === "number" &&
        Number.isSafeInteger(row.rowNumber) &&
        row.rowNumber > 0 &&
        typeof row.error === "string"
      )
        rows.push({ rowNumber: row.rowNumber, error: row.error });
    }
  }
  return {
    status: res.status,
    body: {
      rows,
      ...("code" in payload && typeof payload.code === "string"
        ? { code: payload.code }
        : {}),
      ...("reused" in payload && typeof payload.reused === "boolean"
        ? { reused: payload.reused }
        : {}),
      ...("created" in payload &&
      typeof payload.created === "number" &&
      Number.isSafeInteger(payload.created) &&
      payload.created >= 0
        ? { created: payload.created }
        : {}),
    },
  };
}

export async function getSettings(): Promise<{
  version: number;
  snapshot: Record<string, unknown>;
}> {
  const res = await request("/api/settings");
  if (!res.ok) throw new Error("settings");
  return res.json();
}

export async function proposeSettings(
  patch: Record<string, unknown>,
): Promise<{ approvalId: string }> {
  const res = await request("/api/settings/proposals", {
    method: "POST",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("proposal");
  return res.json();
}

export class ApprovalError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function approve(id: string): Promise<unknown> {
  const res = await request(`/api/approvals/${id}/approve`, { method: "POST" });
  if (!res.ok) {
    const body: unknown = await res.json();
    const code =
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string"
        ? body.code
        : "APPROVAL_FAILED";
    throw new ApprovalError(code);
  }
  return res.json();
}

export async function verifyRecoveryCode(
  code: string,
  trustDevice = false,
): Promise<AuthResult> {
  const res = await request("/api/auth/two-factor/verify-backup-code", {
    method: "POST",
    body: JSON.stringify({ code: code.trim(), trustDevice }),
  });
  return res.json();
}
