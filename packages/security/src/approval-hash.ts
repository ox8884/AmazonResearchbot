import { createHash } from "node:crypto";
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
function canonical(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Approval payload must use plain JSON objects");
    const result: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(result, key, {
        value: canonical(Reflect.get(value, key)),
        enumerable: true,
      });
    }
    return result;
  }
  throw new Error("Approval payload must contain JSON values only");
}
export function exactPayloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
