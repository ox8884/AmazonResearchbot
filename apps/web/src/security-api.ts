import type {
  LoginSession,
  TrustedDevice,
} from "../../../packages/domain/src/login-session.ts";
export class SecurityRequestError extends Error {
  constructor(readonly status: number) {
    super("Security request failed");
  }
}
async function request<T>(
  path: string,
  write = false,
  body: unknown = {},
): Promise<T> {
  const response = await fetch(path, {
    method: write ? "POST" : "GET",
    credentials: "include",
    signal: AbortSignal.timeout(15000),
    ...(write
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new SecurityRequestError(response.status);
  return response.json();
}
export const listLoginSessions = () =>
  request<{ sessions: LoginSession[] }>("/api/security/sessions");
export const revokeLoginSession = (id: string) =>
  request<{ revoked: boolean }>(
    `/api/security/sessions/${encodeURIComponent(id)}/revoke`,
    true,
  );
export const signOut = () => request<unknown>("/api/auth/sign-out", true);

export const listTrustedDevices = () =>
  request<{ devices: TrustedDevice[] }>("/api/security/trusted-devices");
export const revokeTrustedDevice = (id: string) =>
  request<{ revoked: boolean }>(
    `/api/security/trusted-devices/${encodeURIComponent(id)}/revoke`,
    true,
  );

export const getRecoveryCodeStatus = () =>
  request<{ remaining: number | null }>("/api/security/recovery-codes");
export const generateRecoveryCodes = (password: string) =>
  request<{ backupCodes: string[] }>(
    "/api/auth/two-factor/generate-backup-codes",
    true,
    { password },
  );

export type SecurityAuditEvent = {
  id: string;
  action:
    | "approve"
    | "reject"
    | "approval_invalidated"
    | "session_revoked"
    | "trusted_device_revoked";
  createdAt: string;
  approvalKind:
    | "supplier_contact"
    | "order_decision"
    | "budget_or_criteria_change"
    | "provider_activation"
    | null;
  candidateKeyword: string | null;
};
export const listSecurityAudit = () =>
  request<{ events: SecurityAuditEvent[] }>("/api/security/audit");
