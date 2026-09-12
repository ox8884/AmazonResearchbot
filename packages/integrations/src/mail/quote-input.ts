import {
  COST_FIELDS,
  quoteInputSchema,
  type QuoteInput,
} from "@forge-ops/domain";
import { VENDOR_COST_FIELDS, type MailQuoteContext } from "./quote-source.ts";

export function automaticInput(context: MailQuoteContext): QuoteInput | null {
  const p = context.preview;
  if (!p.complete) return null;
  const parsed = quoteInputSchema.safeParse({
    specId: p.specId,
    supplierName: p.supplierName,
    supplierSource: p.supplierSource,
    sourceText: p.sourceText,
    receivedAt: p.receivedAt,
    validUntil: p.validUntil,
    incoterm: p.incoterm,
    quantity: p.quantity,
    moq: p.moq,
    risksConfirmed: false,
    riskSource: "",
    costs: Object.fromEntries(
      COST_FIELDS.map((field) => [
        field,
        p.costs[field] ?? {
          kind: "unknown",
          value: null,
          source: null,
          observedAt: null,
          reason: "NOT_IN_SUPPLIER_REPLY",
        },
      ]),
    ),
  });
  return parsed.success
    ? {
        ...parsed.data,
        sourceText: p.sourceText,
        supplierSource: p.supplierSource,
      }
    : null;
}
function decimal(value: string): string {
  return value
    .replace(/^0+(?=\d)/, "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
export function manualInput(
  context: MailQuoteContext,
  input: QuoteInput,
): QuoteInput | null {
  const p = context.preview;
  if (!p.complete || input.sourceText.trim() !== p.sourceText.trim())
    return null;
  if (
    input.supplierName !== p.supplierName ||
    input.supplierSource !== p.supplierSource ||
    (p.receivedAt !== null &&
      Date.parse(input.receivedAt) !== Date.parse(p.receivedAt))
  )
    return null;
  if (
    (p.quantity !== null && input.quantity !== p.quantity) ||
    (p.moq !== null && input.moq !== p.moq) ||
    (p.incoterm !== null && input.incoterm !== p.incoterm) ||
    input.validUntil !== p.validUntil
  )
    return null;
  for (const field of VENDOR_COST_FIELDS) {
    const quoted = p.costs[field],
      given = input.costs[field];
    if (!quoted && (given.kind === "quote" || given.kind === "measured"))
      return null;
    if (
      quoted &&
      (given.kind !== "quote" || decimal(given.value) !== decimal(quoted.value))
    )
      return null;
  }
  return {
    ...input,
    sourceText: p.sourceText,
    supplierSource: p.supplierSource,
    receivedAt: p.receivedAt ?? input.receivedAt,
    costs: { ...input.costs, ...p.costs },
  };
}
