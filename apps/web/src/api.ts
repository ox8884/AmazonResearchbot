export type NextAction = { kind: "automatic" | "approval" | "waiting"; label: string; target: string };

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

export type Session = { user: { id: string; email: string; twoFactorEnabled: boolean } };

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

export async function signIn(email: string, password: string): Promise<unknown> {
  const res = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function signUp(email: string, password: string, name: string): Promise<unknown> {
  const res = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  return res.json();
}

export async function enableTotp(password: string): Promise<{ totpURI?: string; backupCodes?: string[] }> {
  const res = await request("/api/auth/two-factor/enable", {
    method: "POST",
    body: JSON.stringify({ password, method: "totp" }),
  });
  return res.json();
}

export async function verifyTotp(code: string): Promise<unknown> {
  const res = await request("/api/auth/two-factor/verify-totp", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  return res.json();
}

export async function listCandidates(): Promise<CandidateView[]> {
  const res = await request("/api/candidates");
  if (!res.ok) throw new Error("candidates");
  const body = (await res.json()) as { candidates: CandidateView[] };
  return body.candidates;
}

export async function getCandidate(id: string): Promise<{ candidate: CandidateView; evidence: unknown[] }> {
  const res = await request(`/api/candidates/${id}`);
  if (!res.ok) throw new Error("candidate");
  return res.json();
}

export async function uploadCsv(file: File): Promise<unknown> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/imports", { method: "POST", credentials: "include", body });
  return { status: res.status, body: await res.json() };
}

export async function getSettings(): Promise<{ version: number; snapshot: Record<string, unknown> }> {
  const res = await request("/api/settings");
  if (!res.ok) throw new Error("settings");
  return res.json();
}

export async function proposeSettings(patch: Record<string, unknown>): Promise<{ approvalId: string }> {
  const res = await request("/api/settings/proposals", { method: "POST", body: JSON.stringify(patch) });
  if (!res.ok) throw new Error("proposal");
  return res.json();
}

export async function approve(id: string): Promise<unknown> {
  const res = await request(`/api/approvals/${id}/approve`, { method: "POST" });
  return res.json();
}
