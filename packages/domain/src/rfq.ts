export type SupplierInput = {
  specId?: string | null;
  name: string;
  email: string | null;
  source: string;
  observedAt: string;
  matchStatus: "matches" | "mismatch" | "unknown";
  matchNotes: string;
};
export type SupplierRecord = SupplierInput & {
  id: string;
  candidateId: string;
  createdAt: string;
};
export type RfqInput = {
  aiTaskId?: string | null;
  supplierId: string;
  specId: string;
  quantity: number;
  subject: string;
  body: string;
};
export type RfqState =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sending"
  | "awaiting_quote"
  | "outcome_unknown"
  | "rejected"
  | "stale";
export type RfqRecord = RfqInput & {
  id: string;
  candidateId: string;
  recipient: string;
  revision: number;
  state: RfqState;
  approvalId: string | null;
  createdAt: string;
  deliveryTransport?: string | null;
  deliveryState?: string | null;
  deliveryReason?: string | null;
};
export type ContactApprovalPayload = {
  payloadVersion: 1;
  rfqId: string;
  candidateId: string;
  supplierId: string;
  specId: string;
  revision: number;
  recipient: string;
  subject: string;
  body: string;
  quantity: number;
  settingsVersion: number;
  channel: "email";
};
export type RfqWorkspace = {
  suppliers: SupplierRecord[];
  drafts: RfqRecord[];
  contactReady: boolean;
  blockedReason: string | null;
  deliveryMode: "disabled" | "mailpit" | "smtp";
};
export type RfqTemplateInput = {
  product: string;
  material: string;
  dimensions: string;
  packaging: string;
  requirements: string;
  quantity: number;
};
function rfqDetails(input: RfqTemplateInput): string[] {
  return [
      `Please quote the following product for the US market: ${input.product}.`,
      `Material: ${input.material}`,
      `Dimensions and units: ${input.dimensions}`,
      `Packaging: ${input.packaging}`,
      `Quality / certification requirements: ${input.requirements}`,
      `Requested quantity: ${input.quantity}`,
      "",
      "Please include quantity-tier pricing and MOQ, Incoterm and shipping scope, freight and duties, packed dimensions and weight, sample/tooling/certification charges, lead time, payment terms, and the quote validity date.",
      "For one quantity tier, please use these labels where possible. Use USD and quote the product unit price excluding freight, duty, and preparation fees. Leave unavailable amounts unconfirmed rather than zero.",
      "Quantity (units):",
      "MOQ (units):",
      "Product unit price (USD):",
      "Unit freight (USD):",
      "Unit duty (USD):",
      "Unit prep/inspection (USD):",
      "Other landed unit cost (USD):",
      "Separate upfront costs (USD):",
      "Incoterm:",
      "Valid until:",
      "Please use YYYY-MM-DD for the validity date.",
      "Please identify anything not included in your quotation. This is a request for information, not a purchase order.",
  ];
}
export function rfqTemplate(input: RfqTemplateInput): { subject: string; body: string } {
  return {
    subject: `Request for quotation — ${input.product}`,
    body: [
      "Hello,",
      "",
      ...rfqDetails(input),
      "",
      "Thank you,",
      "Forge Kitchen",
    ].join("\n"),
  };
}
export function rfqWithAiWording(input: RfqTemplateInput, wording: string) {
  return {subject:rfqTemplate(input).subject,body:[wording.trim(),"","Quotation details:",...rfqDetails(input)].join("\n")};
}
export function contactPayload(
  rfq: RfqRecord,
  settingsVersion: number,
): ContactApprovalPayload {
  return {
    payloadVersion: 1,
    rfqId: rfq.id,
    candidateId: rfq.candidateId,
    supplierId: rfq.supplierId,
    specId: rfq.specId,
    revision: rfq.revision,
    recipient: rfq.recipient,
    subject: rfq.subject,
    body: rfq.body,
    quantity: rfq.quantity,
    settingsVersion,
    channel: "email",
  };
}
export type RfqReplyInput = {
  source: string;
  receivedAt: string;
  messageId: string | null;
  body: string;
};
export type RfqReplyRecord = RfqReplyInput & { id: string; createdAt: string; inboxMessageId?: string | null };
