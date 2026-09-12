export type SupplierQuoteField =
  | "quantity"
  | "moq"
  | "incoterm"
  | "validUntil"
  | "productUnitPrice"
  | "unitFreight"
  | "unitDuty"
  | "unitPrepInspection"
  | "otherLandedUnitCost"
  | "separateUpfrontCosts";

export type ExtractedQuoteField = {
  readonly value: string;
  readonly excerpt: string;
  readonly start: number;
  readonly end: number;
};

export type SupplierQuoteExtraction = {
  readonly fields: Readonly<Partial<Record<SupplierQuoteField, ExtractedQuoteField>>>;
  readonly issues: Readonly<Partial<Record<SupplierQuoteField, "missing" | "ambiguous" | "invalid">>>;
};

type Line = { readonly text: string; readonly start: number };
type LabeledValue = { readonly text: string; readonly start: number; readonly label: string };
type Rule = {
  readonly field: SupplierQuoteField;
  readonly label: RegExp;
  readonly parse: (input: LabeledValue) => ExtractedQuoteField | null;
};

const INCOTERMS = new Set(["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]);
const MONEY = /^(?:(USD)\s*)?(\d{1,12}(?:\.\d{1,6})?)(?:\s*(USD))?(?:\s*(?:\/\s*|per\s+)(?:unit|pcs?|pieces?))?$/i;
const TOTAL_MONEY = /^(?:(USD)\s*)?(\d{1,12}(?:\.\d{1,6})?)(?:\s*(USD))?(?:\s+(?:total|one[- ]time))?$/i;

function visibleLines(source: string): readonly Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < source.length) {
    let end = start;
    while (end < source.length && source[end] !== "\r" && source[end] !== "\n") end += 1;
    const text = source.slice(start, end);
    if (/^\s*(?:-----Original Message-----|On\s+.+wrote:)\s*$/i.test(text)) break;
    if (!/^\s*>/.test(text)) lines.push({ text, start });
    if (end === source.length) break;
    start = end + (source[end] === "\r" && source[end + 1] === "\n" ? 2 : 1);
  }
  return lines;
}

function span(input: LabeledValue, value: string): ExtractedQuoteField | null {
  const excerpt = input.text.trim();
  if (!excerpt) return null;
  const offset = input.text.indexOf(excerpt);
  const start = input.start + offset;
  return { value, excerpt, start, end: start + excerpt.length };
}

function normalizedDecimal(value: string): string {
  const separator = value.indexOf(".");
  const whole = (separator < 0 ? value : value.slice(0, separator)).replace(/^0+(?=\d)/, "");
  const decimal = separator < 0 ? "" : value.slice(separator + 1).replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole;
}

function count(input: LabeledValue): ExtractedQuoteField | null {
  const match = /^(\d+)(?:\s*(?:pcs?|units?))?$/i.exec(input.text.trim());
  const value = match?.[1];
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 10_000_000) return null;
  return span(input, String(numeric));
}

function money(input: LabeledValue, pattern: RegExp): ExtractedQuoteField | null {
  const match = pattern.exec(input.text.trim());
  const amount = match?.[2];
  if (!match || !amount || (!match[1] && !match[3] && !/\bUSD\b/i.test(input.label))) return null;
  return span(input, normalizedDecimal(amount));
}

function upfront(input: LabeledValue): ExtractedQuoteField | null {
  if (!/\b(?:total|one[- ]time|separate)\b/i.test(`${input.label} ${input.text}`)) return null;
  return money(input, TOTAL_MONEY);
}

function incoterm(input: LabeledValue): ExtractedQuoteField | null {
  const text = input.text.trim();
  if (text.length > 200) return null;
  const match = /^([a-z]{3})(.*)$/i.exec(text);
  const code = match?.[1]?.toUpperCase();
  const rest = match?.[2] ?? "";
  if (!code || !INCOTERMS.has(code) || (rest && !/^\s|^[-,(]/.test(rest))) return null;
  return span(input, rest.trim() ? `${code} ${rest.trim()}` : code);
}

function validDate(input: LabeledValue): ExtractedQuoteField | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.text.trim());
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null;
  return span(input, input.text.trim());
}

const RULES: readonly Rule[] = [
  { field: "quantity", label: /^\s*(?:quantity|qty)(?:\s*(?:\(\s*(?:pcs?|units?)\s*\)|\/\s*(?:pcs?|units?)))?\s*[:=-]\s*(.*)$/i, parse: count },
  { field: "moq", label: /^\s*MOQ(?:\s*(?:\(\s*(?:pcs?|units?)\s*\)|\/\s*(?:pcs?|units?)))?\s*[:=-]\s*(.*)$/i, parse: count },
  { field: "incoterm", label: /^\s*incoterms?\s*[:=-]\s*(.*)$/i, parse: incoterm },
  { field: "validUntil", label: /^\s*(?:valid\s+until|quote\s+valid\s+until|validity\s+date)\s*[:=-]\s*(.*)$/i, parse: validDate },
  { field: "productUnitPrice", label: /^\s*product\s+unit\s+price(?:\s*(?:\(\s*USD\s*\)|USD))?\s*[:=-]\s*(.*)$/i, parse: (input) => money(input, MONEY) },
  { field: "unitFreight", label: /^\s*(?:unit\s+freight|freight\s+per\s+unit)(?:\s*(?:\(\s*USD\s*\)|USD))?\s*[:=-]\s*(.*)$/i, parse: (input) => money(input, MONEY) },
  { field: "unitDuty", label: /^\s*(?:unit\s+duty|duty\s+per\s+unit)(?:\s*(?:\(\s*USD\s*\)|USD))?\s*[:=-]\s*(.*)$/i, parse: (input) => money(input, MONEY) },
  { field: "unitPrepInspection", label: /^\s*unit\s+(?:prep(?:aration)?|inspection)(?:\s*(?:\/|&|and)\s*(?:prep(?:aration)?|inspection))?(?:\s*(?:\(\s*USD\s*\)|USD))?\s*[:=-]\s*(.*)$/i, parse: (input) => money(input, MONEY) },
  { field: "otherLandedUnitCost", label: /^\s*other\s+landed\s+unit\s+cost(?:\s*(?:\(\s*USD\s*\)|USD))?\s*[:=-]\s*(.*)$/i, parse: (input) => money(input, MONEY) },
  { field: "separateUpfrontCosts", label: /^\s*(?:(?:separate|total|one[-\s]time)\s+)?upfront\s+(?:costs?|charges?)(?:\s*(?:\(\s*(?:USD|total)\s*\)|USD))?\s*[:=-]\s*(.*)$/i, parse: upfront },
];

function select(source: string, rule: Rule): { readonly field: ExtractedQuoteField } | { readonly issue: "missing" | "ambiguous" | "invalid" } {
  let occurrences = 0;
  let parsed: ExtractedQuoteField | null = null;
  for (const line of visibleLines(source)) {
    const match = rule.label.exec(line.text);
    const text = match?.[1];
    const matched = match?.[0];
    if (text === undefined || matched === undefined || !text.trim()) continue;
    occurrences += 1;
    const start = line.start + matched.length - text.length;
    const candidate = rule.parse({ text, start, label: line.text.slice(0, start - line.start) });
    if (candidate) parsed = candidate;
  }
  if (occurrences === 0) return { issue: "missing" };
  if (occurrences > 1) return { issue: "ambiguous" };
  return parsed ? { field: parsed } : { issue: "invalid" };
}

export function extractSupplierQuote(text: string): SupplierQuoteExtraction {
  const fields: Partial<Record<SupplierQuoteField, ExtractedQuoteField>> = {};
  const issues: Partial<Record<SupplierQuoteField, "missing" | "ambiguous" | "invalid">> = {};
  for (const rule of RULES) {
    const result = select(text, rule);
    if ("field" in result) fields[rule.field] = result.field;
    else issues[rule.field] = result.issue;
  }
  return { fields, issues };
}
