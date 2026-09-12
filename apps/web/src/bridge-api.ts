import { bridgeDevicesSchema, bridgePairingSchema, bridgePairingStatusSchema, bridgeSigningIdentitySchema } from "../../../packages/domain/src/browser-device.ts";

export class BridgeConnectionError extends Error {
  constructor(readonly code: string) { super(code); }
}
async function request(path: string, body?: Record<string, never>): Promise<unknown> {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "include", cache: "no-store",
    signal: AbortSignal.timeout(15000), ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new BridgeConnectionError(typeof data === "object" && data !== null && "code" in data && typeof data.code === "string" ? data.code : "BRIDGE_REQUEST_FAILED");
  return data;
}
export async function getBrowserDevices() { return bridgeDevicesSchema.parse(await request("/api/bridge/devices")); }
export async function getBrowserSigningIdentity() { return bridgeSigningIdentitySchema.parse(await request("/api/bridge/signing-key")); }
export async function createBrowserPairing() { return bridgePairingSchema.parse(await request("/api/bridge/pairings", {})); }
export async function getBrowserPairingStatus(id: string) { return bridgePairingStatusSchema.parse(await request("/api/bridge/pairings/" + encodeURIComponent(id))); }
export async function revokeBrowserDevice(id: string): Promise<void> {
  const result = await request("/api/bridge/devices/" + encodeURIComponent(id) + "/revoke", {});
  if (typeof result !== "object" || result === null || !("revoked" in result) || result.revoked !== true) throw new BridgeConnectionError("BRIDGE_REVOKE_UNCONFIRMED");
}
