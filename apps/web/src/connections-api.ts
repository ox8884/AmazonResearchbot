export type GmailConnectionState = {
  configured: boolean;
  status: string;
  email: string | null;
  expectedEmail: string | null;
  checkedAt: string | null;
};
export class ConnectionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
async function request(action?: "connect" | "refresh") {
  const response = await fetch(
    "/api/connections/gmail" + (action ? "/" + action : ""),
    {
      method: action ? "POST" : "GET",
      credentials: "include",
      signal: AbortSignal.timeout(65000),
      ...(action
        ? { headers: { "content-type": "application/json" }, body: "{}" }
        : {}),
    },
  );
  if (!response.ok) {
    const data: unknown = await response.json();
    throw new ConnectionError(
      typeof data === "object" &&
        data !== null &&
        "code" in data &&
        typeof data.code === "string"
        ? data.code
        : "CONNECTION_FAILED",
    );
  }
  return response;
}
export async function gmailStatus(): Promise<GmailConnectionState> {
  return (await request()).json();
}
export async function gmailRefresh(): Promise<GmailConnectionState> {
  return (await request("refresh")).json();
}
export async function gmailConnect(): Promise<{
  redirectUrl?: string;
  alreadyConnected?: boolean;
}> {
  return (await request("connect")).json();
}
