import {
  readApprovedSettings,
  quoteRecordView,
  type Pool,
  type SupplierQuoteRow,
} from "@forge-ops/db";
import {
  extractSupplierQuote,
  inboxCaptureOwner,
  type InboxQuotePreview,
  type CostField,
  type KnownCostEvidence,
  type SupplierQuoteExtraction,
  type SupplierQuoteField,
} from "@forge-ops/domain";
import { decryptSecret } from "@forge-ops/security";
export const MAIL_QUOTE_PARSER_VERSION = "supplier-labels-v1";
export type MailQuoteConnection = Pick<Pool, "query">;
export type MailQuoteSource = {
  readonly id: string;
  readonly profile_id: string;
  readonly mailbox_key: string;
  readonly uid_validity: string;
  readonly uid: string;
  readonly body_ciphertext: string | null;
  readonly body_state: string;
  readonly received_at: Date | null;
  readonly classification: string;
  readonly rfq_id: string | null;
  readonly candidate_id: string | null;
  readonly spec_id: string | null;
  readonly supplier_name: string | null;
  readonly stage: string | null;
};
export type MailQuoteContext = {
  readonly source: MailQuoteSource;
  readonly body: string | null;
  readonly extraction: SupplierQuoteExtraction;
  readonly preview: InboxQuotePreview;
};
export const VENDOR_COST_FIELDS = [
  "productUnitPrice",
  "unitFreight",
  "unitDuty",
  "unitPrepInspection",
  "otherLandedUnitCost",
  "separateUpfrontCosts",
] as const;
const QUOTE_FIELDS = [
  "quantity",
  "moq",
  "incoterm",
  "validUntil",
  ...VENDOR_COST_FIELDS,
] as const;
const labels: Readonly<Record<SupplierQuoteField, string>> = {
  quantity: "Quantity",
  moq: "MOQ",
  incoterm: "Incoterm",
  validUntil: "Valid until",
  productUnitPrice: "Product unit price (USD)",
  unitFreight: "Freight per unit (USD)",
  unitDuty: "Duty per unit (USD)",
  unitPrepInspection: "Prep / inspection per unit (USD)",
  otherLandedUnitCost: "Other landed unit cost (USD)",
  separateUpfrontCosts: "Separate upfront costs (USD)",
};

export async function readMailQuoteContext(
  db: MailQuoteConnection,
  key: Buffer,
  id: string,
): Promise<MailQuoteContext | null> {
  const rows = await db.query<MailQuoteSource>(
    `SELECT m.id,m.profile_id,b.mailbox_key,b.uid_validity,m.uid::text,m.body_ciphertext,m.body_state,m.received_at,
 CASE WHEN l.inbox_message_id IS NOT NULL THEN 'linked' ELSE m.classification END AS classification,
 r.id AS rfq_id,r.candidate_id,r.spec_id,s.name AS supplier_name,c.stage
 FROM inbox_messages m JOIN inbox_mailboxes b ON b.id=m.mailbox_id
 LEFT JOIN inbox_message_links l ON l.inbox_message_id=m.id
 LEFT JOIN rfq_drafts r ON r.id=COALESCE(l.rfq_id,m.rfq_id)
 LEFT JOIN sourcing_suppliers s ON s.id=r.supplier_id LEFT JOIN candidates c ON c.id=r.candidate_id WHERE m.id=$1`,
    [id],
  );
  const source = rows.rows[0];
  if (!source) return null;
  const body =
    source.body_ciphertext === null
      ? null
      : decryptSecret(
          source.body_ciphertext,
          key,
          inboxCaptureOwner(
            {
              profileId: source.profile_id,
              mailboxKey: source.mailbox_key,
              uidValidity: source.uid_validity,
              uid: source.uid,
            },
            "body",
          ),
        ).toString("utf8");
  const extraction = extractSupplierQuote(
    source.body_state === "text" ? (body ?? "") : "",
  );
  const fields = extraction.fields;
  const receivedAt = source.received_at?.toISOString() ?? null;
  const costs: Partial<Record<CostField, KnownCostEvidence>> = {};
  if (receivedAt) {
    for (const field of VENDOR_COST_FIELDS) {
      const value = fields[field];
      if (value)
        costs[field] = {
          kind: "quote",
          value: value.value,
          source: labels[field] + ": " + value.excerpt,
          observedAt: receivedAt,
        };
    }
  }
  const bound =
    source.classification === "linked" &&
    source.candidate_id !== null &&
    source.spec_id !== null;
  const excerpts = QUOTE_FIELDS.flatMap((field) => {
    const value = fields[field];
    return value
      ? [{ start: value.start, text: labels[field] + ": " + value.excerpt }]
      : [];
  })
    .sort((a, b) => a.start - b.start)
    .map((value) => value.text);
  const sourceText =
    body && body.length <= 10000
      ? body
      : "Supplier reply conditions (full original retained in the reply inbox):\n" +
        excerpts.join("\n");
  const quantity = fields.quantity ? Number(fields.quantity.value) : null,
    moq = fields.moq ? Number(fields.moq.value) : null;
  const quotes = await db.query<SupplierQuoteRow & { source_extraction: unknown }>(
    `SELECT q.*,q.valid_until::text AS valid_until,l.inbox_message_id AS source_inbox_id,l.extraction AS source_extraction FROM inbox_quote_records l JOIN supplier_quotes q ON q.id=l.quote_id WHERE l.inbox_message_id=$1 ORDER BY l.record_order DESC LIMIT 1`,
    [id],
  );
  const quoteRow = quotes.rows[0];
  const savedExtraction = quoteRow?.source_extraction;
  const operatorEvidence = typeof savedExtraction === "object" && savedExtraction !== null && "operatorEvidence" in savedExtraction && typeof savedExtraction.operatorEvidence === "string" ? savedExtraction.operatorEvidence : "";
  const quote = quoteRow
    ? quoteRecordView(quoteRow, await readApprovedSettings(db))
    : null;
  const preview: InboxQuotePreview = {
    inboxMessageId: id,
    candidateId: bound ? source.candidate_id : null,
    specId: bound ? source.spec_id : null,
    bound,
    complete:
      bound &&
      receivedAt !== null &&
      quantity !== null &&
      moq !== null &&
      quantity >= moq &&
      Boolean(fields.incoterm) &&
      Boolean(costs.productUnitPrice),
    supplierName: bound ? source.supplier_name : null,
    supplierSource: "Supplier email reply",
    sourceText,
    operatorEvidence,
    receivedAt,
    validUntil: fields.validUntil?.value ?? null,
    incoterm: fields.incoterm?.value ?? null,
    quantity,
    moq,
    costs,
    issues: QUOTE_FIELDS.flatMap((field) => {
      const reason = extraction.issues[field];
      return reason ? [{ field, reason }] : [];
    }),
    quote,
  };
  return { source, body, extraction, preview };
}
