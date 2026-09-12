import { estimate, measured, unknown, type Evidence } from "@forge-ops/domain";
import type { Source, ParseResult, ProductFamily } from "./response-types.ts";
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rows(
  value: unknown,
): readonly Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const result: Record<string, unknown>[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    result.push(item);
  }
  return result;
}

export function attributes(
  row: Record<string, unknown>,
  type: string,
): Record<string, unknown> | null {
  return row["type"] === type && isRecord(row["attributes"])
    ? row["attributes"]
    : null;
}

export function estimatedNumber(
  value: unknown,
  source: Source,
  reason: string,
): Evidence<number> {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? estimate(value, source.sourceId, source.observedAt)
    : unknown(reason, source.sourceId);
}

export function measuredNumber(
  value: unknown,
  source: Source,
  reason: string,
): Evidence<number> {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? measured(value, source.sourceId, source.observedAt)
    : unknown(reason, source.sourceId);
}

export function measuredInteger(
  value: unknown,
  source: Source,
  reason: string,
): Evidence<number> {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? measured(value, source.sourceId, source.observedAt)
    : unknown(reason, source.sourceId);
}

export function measuredText(
  value: unknown,
  source: Source,
  reason: string,
): Evidence<string> {
  return typeof value === "string" && value.length > 0
    ? measured(value, source.sourceId, source.observedAt)
    : unknown(reason, source.sourceId);
}

export function measuredBoolean(
  value: unknown,
  source: Source,
  reason: string,
): Evidence<boolean> {
  return typeof value === "boolean"
    ? measured(value, source.sourceId, source.observedAt)
    : unknown(reason, source.sourceId);
}

export function measuredStringArray(
  value: unknown,
  source: Source,
): Evidence<readonly string[]> {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => typeof item !== "string" || !/^[A-Z0-9]{10}$/.test(item),
    )
  ) {
    return unknown("VARIANTS_UNKNOWN", source.sourceId);
  }
  return measured(value, source.sourceId, source.observedAt);
}

export function measuredUpdatedAt(
  value: unknown,
  source: Source,
): Evidence<string> {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? measured(value, source.sourceId, source.observedAt)
    : unknown("UPDATED_AT_UNKNOWN", source.sourceId);
}

export function productAsin(value: unknown, source: Source): Evidence<string> {
  if (typeof value !== "string")
    return unknown("ASIN_UNKNOWN", source.sourceId);
  const parts = value.split("/");
  const asin = parts[1];
  return parts.length === 2 &&
    parts[0] === "us" &&
    asin !== undefined &&
    /^[A-Z0-9]{10}$/.test(asin)
    ? measured(asin, source.sourceId, source.observedAt)
    : unknown("ASIN_UNKNOWN", source.sourceId);
}

export function family(
  attributes: Record<string, unknown>,
  asin: Evidence<string>,
  source: Source,
): ProductFamily {
  const parentValue = attributes["parent_asin"];
  const parentAsin =
    typeof parentValue === "string" && /^[A-Z0-9]{10}$/.test(parentValue)
      ? measured(parentValue, source.sourceId, source.observedAt)
      : unknown("PARENT_ASIN_UNKNOWN", source.sourceId);
  const isVariant = measuredBoolean(
    attributes["is_variant"],
    source,
    "VARIANT_STATUS_UNKNOWN",
  );
  const isParent = measuredBoolean(
    attributes["is_parent"],
    source,
    "PARENT_STATUS_UNKNOWN",
  );
  const variants = measuredStringArray(attributes["variants"], source);
  if (isVariant.kind === "unknown" || asin.kind === "unknown") {
    return { kind: "unknown", reason: "FAMILY_UNRESOLVED" };
  }
  if (isVariant.value && parentAsin.kind === "unknown")
    return { kind: "unknown", reason: "FAMILY_UNRESOLVED" };
  if (
    (isVariant.value && isParent.kind !== "unknown" && isParent.value) ||
    (!isVariant.value &&
      parentAsin.kind !== "unknown" &&
      parentAsin.value !== asin.value) ||
    (isVariant.value &&
      parentAsin.kind !== "unknown" &&
      parentAsin.value === asin.value)
  )
    return { kind: "unknown", reason: "FAMILY_UNRESOLVED" };
  return {
    kind: "known",
    key: isVariant.value ? parentAsin : asin,
    parentAsin,
    isVariant,
    isParent,
    variants,
  };
}

export function dataRows(
  raw: unknown,
): readonly Record<string, unknown>[] | null {
  return isRecord(raw) ? rows(raw["data"]) : null;
}

export function responseError<T>(): ParseResult<T> {
  return { ok: false, code: "UNEXPECTED_SCHEMA" };
}

export { isIsoDay as isoDay } from "@forge-ops/domain";
export function normalizeKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}
export function keywordIdentity(value: unknown, expected?: string): boolean {
  if (
    typeof value !== "string" ||
    !value.startsWith("us/") ||
    value.slice(3).trim().length === 0
  )
    return false;
  return (
    expected === undefined ||
    normalizeKeyword(value.slice(3)) === normalizeKeyword(expected)
  );
}
export function estimatedInteger(
  value: unknown,
  source: Source,
  reason: string,
): Evidence<number> {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? estimate(value, source.sourceId, source.observedAt)
    : unknown(reason, source.sourceId);
}
export function estimatedTrend(
  value: unknown,
  source: Source,
): Evidence<number> {
  return typeof value === "number" && Number.isFinite(value)
    ? estimate(value, source.sourceId, source.observedAt)
    : unknown("TREND_UNKNOWN", source.sourceId);
}
