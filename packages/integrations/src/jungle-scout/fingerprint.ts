import { createHash } from "node:crypto";

export const NORMALIZER_VERSION = 1;
export const API_VERSION = "junglescout.v1";

function normalizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = normalizeValue(record[key]);
    return out;
  }
  return value;
}

export function requestFingerprint(input: {
  provider: string;
  accountScope: string;
  endpoint: string;
  method: string;
  marketplace: string;
  normalizedQuery: unknown;
  period: unknown;
  filters: unknown;
  sort: unknown;
  pagination: unknown;
}): string {
  const canonical = JSON.stringify(
    normalizeValue({
      provider: input.provider,
      accountScope: input.accountScope,
      endpoint: input.endpoint,
      method: input.method,
      marketplace: input.marketplace,
      normalizedQuery: input.normalizedQuery,
      period: input.period,
      filters: input.filters,
      sort: input.sort,
      pagination: input.pagination,
      apiVersion: API_VERSION,
      normalizerVersion: NORMALIZER_VERSION,
    }),
  );
  return createHash("sha256").update(canonical).digest("hex");
}
