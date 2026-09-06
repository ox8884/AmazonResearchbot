import { createHash } from "node:crypto";
import { parse } from "csv-parse";
import { normalizeKeyword } from "@forge-ops/domain";

export const SYNTHETIC_SCHEMA = "synthetic.kitchen.v1";
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 10_000;

export type ParsedRow = {
  rowNumber: number;
  raw: Record<string, string>;
  keywordRaw: string;
  normalizedKeyword: string;
  error: string | null;
};

export type ParseResult = {
  sha256: string;
  byteSize: number;
  rows: ParsedRow[];
  validCount: number;
};

function detectKeyword(record: Record<string, string>): string | null {
  const keys = Object.keys(record);
  const preferred = keys.find((k) => k.trim().toLowerCase() === "keyword");
  if (preferred) return record[preferred] ?? "";
  if (keys.length === 0) return null;
  return record[keys[0] ?? ""] ?? "";
}

export async function parseCsv(bytes: Buffer): Promise<ParseResult> {
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: ParsedRow[] = [];
  const parser = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });

  let rowNumber = 0;
  for await (const record of parser) {
    rowNumber += 1;
    if (rowNumber > MAX_ROWS) throw new Error("TOO_MANY_ROWS");
    const raw = record as Record<string, string>;
    const keywordRaw = detectKeyword(raw);
    if (keywordRaw == null || keywordRaw.trim() === "") {
      rows.push({
        rowNumber,
        raw,
        keywordRaw: keywordRaw ?? "",
        normalizedKeyword: "",
        error: "missing keyword",
      });
      continue;
    }
    rows.push({
      rowNumber,
      raw,
      keywordRaw,
      normalizedKeyword: normalizeKeyword(keywordRaw),
      error: null,
    });
  }

  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.error || row.normalizedKeyword === "") continue;
    const prev = seen.get(row.normalizedKeyword);
    if (prev != null) {
      row.error = `duplicate keyword of row ${prev}`;
    } else {
      seen.set(row.normalizedKeyword, row.rowNumber);
    }
  }

  return {
    sha256,
    byteSize: bytes.byteLength,
    rows,
    validCount: rows.filter((r) => r.error == null).length,
  };
}
