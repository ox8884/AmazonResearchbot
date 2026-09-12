export const EVIDENCE_KINDS = ["measured", "estimate", "quote", "unknown"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type KnownKind = "measured" | "estimate" | "quote";

export type KnownEvidence<T> = {
  kind: KnownKind;
  value: T;
  sourceId: string;
  observedAt: string;
};

export type UnknownEvidence = {
  kind: "unknown";
  value: null;
  sourceId: string | null;
  observedAt: string | null;
  reason: string;
};

export type Evidence<T> = KnownEvidence<T> | UnknownEvidence;

export type DecimalString = string;

export function isKnown<T>(e: Evidence<T>): e is KnownEvidence<T> {
  return e.kind !== "unknown";
}

export function unknown(reason: string, sourceId: string | null = null): UnknownEvidence {
  return { kind: "unknown", value: null, sourceId, observedAt: null, reason };
}

export function measured<T>(value: T, sourceId: string, observedAt: string): KnownEvidence<T> {
  return { kind: "measured", value, sourceId, observedAt };
}

export function estimate<T>(value: T, sourceId: string, observedAt: string): KnownEvidence<T> {
  return { kind: "estimate", value, sourceId, observedAt };
}

export function quote<T>(value: T, sourceId: string, observedAt: string): KnownEvidence<T> {
  return { kind: "quote", value, sourceId, observedAt };
}

/** Parse a CSV numeric cell. `< 450`, blank, null stay unknown — never 0. */
export function parseNumericCell(
  raw: string | null | undefined,
  sourceId: string,
  observedAt: string,
): Evidence<DecimalString> {
  if (raw == null) return unknown("missing", sourceId);
  const trimmed = raw.trim();
  if (trimmed === "") return unknown("empty", sourceId);
  const inequality = /^(<=|>=|<|>)\s*(.+)$/.exec(trimmed);
  if (inequality) {
    const bound = inequality[2]?.trim() ?? "";
    return unknown(`inequality ${trimmed}; bound ${bound} is not an exact value`, sourceId);
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return unknown(`not numeric: ${trimmed}`, sourceId);
  }
  if (!Number.isFinite(Number(trimmed))) return unknown("number_out_of_range", sourceId);
  return measured(trimmed, sourceId, observedAt);
}

export function requireKnown<T>(e: Evidence<T>, label: string): KnownEvidence<T> {
  if (!isKnown(e)) {
    throw new Error(`cannot calculate with unknown ${label}: ${e.reason}`);
  }
  return e;
}
