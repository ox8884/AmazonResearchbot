import { sign, type KeyObject } from "node:crypto";
import { browserTaskSchema, BROWSER_TASK_SIGNATURE_PREFIX, MAX_BROWSER_TASK_BYTES } from "@forge-ops/domain";

export function signBrowserTask(input: unknown, privateKey: KeyObject) {
  const parsed = browserTaskSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_BROWSER_TASK");
  const origin = new URL(parsed.data.issuerOrigin);
  const local = origin.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(origin.hostname);
  if ((!local && origin.protocol !== "https:") || origin.origin !== parsed.data.issuerOrigin || origin.username || origin.password) {
    throw new Error("INVALID_BROWSER_TASK_ORIGIN");
  }
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") throw new Error("INVALID_BROWSER_SIGNING_KEY");
  const bytes = Buffer.from(JSON.stringify(parsed.data));
  if (bytes.length > MAX_BROWSER_TASK_BYTES) throw new Error("BROWSER_TASK_TOO_LARGE");
  const payload = bytes.toString("base64url");
  return {
    version: 1 as const,
    payload,
    signature: sign(null, Buffer.from(BROWSER_TASK_SIGNATURE_PREFIX + payload), privateKey).toString("base64url"),
  };
}
