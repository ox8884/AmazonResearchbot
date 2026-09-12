import { createHash } from "node:crypto";
import { parse } from "csv-parse";
import { normalizeKeyword, CSV_FIELDS, type CsvMapping, type CsvField } from "@forge-ops/domain";

export const SYNTHETIC_SCHEMA = "synthetic.kitchen.v1";
export const MAPPED_CSV_SCHEMA = 'csv.user-mapped.v1';
const OPPORTUNITY_HEADER = 'Keyword,Niche Score,Units Sold - Monthly Avg,Price - Monthly Avg,Search Volume - 30 Day Exact,Search Trend - 30 Day,Search Trend - 90 Day,Competition,Seasonality,Last Updated';
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 10_000;

export type ParsedRow = {
  rowNumber: number;
  raw: Record<string, string>;
  values: Partial<Record<CsvField,string>>;
  keywordRaw: string;
  normalizedKeyword: string;
  error: string | null;
};

export type ParseResult = {
  sha256: string;
  byteSize: number;
  rows: ParsedRow[];
  validCount: number;
  headers: string[];
  mapping: CsvMapping;
  defaultMapping: CsvMapping;
  headerError: string | null;
  mappedSchema: string;
};

function stringRecord(value:unknown):value is Record<string,string> {
  return typeof value==='object'&&value!==null&&!Array.isArray(value)&&Object.values(value).every(cell=>typeof cell==='string');
}

export async function parseCsv(bytes: Buffer, selectedMapping?: CsvMapping): Promise<ParseResult> {
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let mappedSchema=MAPPED_CSV_SCHEMA;
  const preamble=/^JUNGLESCOUT WEBAPP CSV EXPORT\r?\nReport Generated at: [^\r\n]+\r?\n/.exec(text)?.[0];
  if(preamble){
    const data=text.slice(preamble.length);
    text=data;
    mappedSchema=data.split(/\r?\n/,1)[0]===OPPORTUNITY_HEADER
      ? 'csv.user-mapped.junglescout-opportunity-finder.v1'
      : 'csv.user-mapped.report-preamble.v1';
  }

  const rows: ParsedRow[] = [];
  let headerError: string | null = null;
  let headers: string[] = [], mapping:CsvMapping={}, defaultMapping:CsvMapping={};
  const parser = parse(text, {
    columns: (columns: string[]) => {
      headers=columns;
      const normalized = headers.map((header) => header.trim().toLowerCase());
      defaultMapping={};
      for(const field of CSV_FIELDS){
        const aliases = field === 'representative_asin' ? ['representativeasin','representative_asin'] : [field];
        const found=headers.find(h=>aliases.includes(h.trim().toLowerCase()));
        if(found!==undefined)defaultMapping[field]=found;
      }
      mapping=selectedMapping===undefined?{...defaultMapping}:{...selectedMapping};
      if (new Set(normalized).size !== normalized.length)
        headerError = "duplicate columns";
      else if(Object.values(mapping).some(column=>column!==undefined&&!headers.includes(column)))headerError='mapped column missing';
      else if (!mapping.keyword)
        headerError = "keyword column required";
      return headers;
    },
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });

  let rowNumber = 0;
  for await (const record of parser) {
    rowNumber += 1;
    if (rowNumber > MAX_ROWS) throw new Error("TOO_MANY_ROWS");
    if(!stringRecord(record))throw new Error('INVALID_CSV_RECORD');
    const raw = record;
    const values:Partial<Record<CsvField,string>>={};
    for(const field of CSV_FIELDS){const column=mapping[field];if(column!==undefined)values[field]=Object.hasOwn(raw,column)?raw[column]??'':'';}
    const keywordRaw = values.keyword??null;
    const marketplaceHeaders=[defaultMapping.marketplace,mapping.marketplace].filter((value):value is string=>value!==undefined);
    const marketplaceError =
      marketplaceHeaders.some(header=>!Object.hasOwn(raw,header)||raw[header]?.trim().toLowerCase()!=="us")
        ? "marketplace must be us"
        : null;
    const rowError = headerError ?? marketplaceError;
    if (rowError || keywordRaw == null || keywordRaw.trim() === "") {
      rows.push({
        rowNumber,
        raw,
        values,
        keywordRaw: keywordRaw ?? "",
        normalizedKeyword: "",
        error: rowError ?? "missing keyword",
      });
      continue;
    }
    rows.push({
      rowNumber,
      raw,
      values,
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
    headers,mapping,defaultMapping,headerError,mappedSchema,
  };
}
