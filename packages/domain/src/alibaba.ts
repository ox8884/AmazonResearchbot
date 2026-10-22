import { z } from "zod";
import { supplierDetailCompanyUrlSchema, supplierDetailProductUrlSchema } from "./supplier-detail.ts";

const uuid = z.string().uuid();
const accountId = z.string().regex(/^[0-9]{1,30}$/);

export const alibabaNonbinding = "This is a nonbinding request for quotation only. It is not an order, offer acceptance, sample purchase, contract, payment authorization, or commitment to any quantity. Do not start production or ship anything.";
export const alibabaBindingRequest = /(?:please\s+(?:pay|sign|confirm\s+(?:(?:the|your|our)\s+)?order)|payment\s+(?:link|required)|make\s+(?:(?:a|the|your)\s+)?payment|(?:pay|send|transfer(?:red)?)\s+(?:(?:a|the|your)\s+)?deposit|proforma\s+invoice|\bP\.?I\b|sign\s+(?:(?:a|the)\s+)?contract|(?:place|proceed\s+with|accept|confirm)\s+(?:(?:a|an|the|this|your|our)\s+)?(?:order|offer)|arrange\s+(?:(?:the|mass)\s+)*production|付款|定金|订金|下单|合同|形式发票|ignore\s+(?:all\s+)?previous|system\s+prompt)/i;
export function alibabaReplyIsSafe(body: string): boolean {
  const commitment = /(?:\b(?:agreed|approved|go\s+ahead)\b|\b(?:we|i)['’]ll\s+(?:pay|buy|purchase|order|sign|transfer|send|take)\b|\b(?:we|i)\s+(?:accept|agree|commit|confirm|authorize|order|buy|purchase|will\s+(?:pay|buy|purchase|order|sign|transfer|send|take))\b|\b(?:start|begin|proceed\s+with)\s+(?:(?:the|mass|our)\s+)?production\b|\b(?:ship|send|reserve|book)\s+(?:(?:a|the|our|us|any|these|those|\d+(?:[.,]\d+)?)\s+)*(?:samples?|orders?|goods|units?|pieces?)\b|\b(?:please\s+)?invoice\s+(?:us|me|our\s+company)\b|https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i;
  const withoutProhibition = body.replace(/(?:^|[.!?;]\s*)(?:(?:please\s+)?do\s+not\s+(?:(?:ship|send)\s+(?:a\s+|any\s+)?samples?(?:\s+at\s+this\s+stage|,\s+and\s+(?:please\s+)?do\s+not\s+start\s+production\s+or\s+ship\s+anything)?|start\s+production\s+or\s+ship\s+anything)|we\s+are\s+not\s+asking\s+you\s+to\s+start\s+production\s+or\s+ship\s+anything)\s*(?=[.!?;](?:\s|$)|$)/gi, " ");
  return body.trim().length > 0 && body.length <= 3000 && !/[\u0000-\b\u000b\u000c\u000e-\u001f]/.test(body) && !alibabaBindingRequest.test(body) && !commitment.test(withoutProhibition);
}
export const alibabaMessageAnchorSchema = z.object({
  providerMessageId: z.string().min(1).max(300),
  sentAt: z.string().datetime({ offset: true }), bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const alibabaNegotiationContextSchema = z.object({
  keyword: z.string().trim().min(1).max(500), specification: z.string().min(1).max(4000),
  lastOutbound: alibabaMessageAnchorSchema, round: z.number().int().min(1).max(3),
}).strict();
export const alibabaNegotiationDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reply"), body: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ kind: z.literal("review"), reason: z.enum(["AI_UNAVAILABLE", "AI_RESPONSE_INVALID", "NEGOTIATION_CONTEXT_TOO_LARGE", "BINDING_REQUEST_REQUIRES_REVIEW", "NEGOTIATION_REQUIRES_REVIEW"]) }).strict(),
]);
export const alibabaProposalSchema = z.object({
  basedOnInbound: alibabaMessageAnchorSchema, decision: alibabaNegotiationDecisionSchema,
  execution: z.object({ sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), provider: z.string().min(1).max(200), model: z.string().min(1).max(200) }).strict().nullable(),
}).strict().refine(value => value.decision.kind !== "reply" || value.execution !== null,
  { message: "AI replies require execution provenance" });
export type AlibabaMessageAnchor = z.infer<typeof alibabaMessageAnchorSchema>;
export type AlibabaNegotiationContext = z.infer<typeof alibabaNegotiationContextSchema>;
export type AlibabaProposal = z.infer<typeof alibabaProposalSchema>;

export const alibabaThreadFields = {
  candidateId: uuid, specId: uuid.nullable(),
  inputVersion: z.number().int().positive(), settingsVersion: z.number().int().positive(),
  conversationId: uuid, companyName: z.string().trim().min(1).max(300),
  companyUrl: supplierDetailCompanyUrlSchema, productUrl: supplierDetailProductUrlSchema,
  threadId: z.string().min(1).max(300).nullable(), accountId: accountId.nullable(),
};
export const alibabaThreadRequestSchema = z.object({ kind: z.literal("supplier_thread"), ...alibabaThreadFields, negotiation: alibabaNegotiationContextSchema.optional() }).strict();
export const alibabaSendRequestSchema = z.object({ kind: z.literal("supplier_send"), ...alibabaThreadFields,
  accountId, threadId: z.string().min(1).max(300), actionId: uuid, body: z.string().min(1).max(4000), basedOnInbound: alibabaMessageAnchorSchema.optional(),
}).strict();
export const alibabaMessageSchema = z.object({
  id: z.string().min(1).max(300), direction: z.enum(["inbound", "outbound"]),
  body: z.string().min(1).max(30000), sentAt: z.string().datetime({ offset: true }),
}).strict();
export const alibabaObservationSchema = z.object({
  protocol: z.literal(1), kind: z.literal("captured"), scope: z.literal("alibaba_thread"),
  conversationId: uuid, actionId: uuid.nullable(),
  companyName: z.string().trim().min(1).max(300), companyUrl: supplierDetailCompanyUrlSchema,
  productUrl: supplierDetailProductUrlSchema, threadId: z.string().min(1).max(300),
  accountId: z.string().regex(/^[0-9]{1,30}$/),
  sourcePageUrl: z.string().url().max(4096).regex(new RegExp("^https://message[.]alibaba[.]com/message/messenger[.]htm(?:[?#].*)?$")),
  observedAt: z.string().datetime({ offset: true }), snapshot: z.string().min(1).max(2000000),
  messages: z.array(alibabaMessageSchema).max(1000), proposal: alibabaProposalSchema.optional(),
  sendStatus: z.enum(["read", "sent", "not_sent", "unknown"]),
  reason: z.string().regex(/^[A-Z0-9_]+$/).max(100).nullable(),
}).strict().refine(value => value.proposal === undefined || value.sendStatus === "read",
  { message: "Only thread reads may propose a negotiation reply" })
 .refine(value => (value.sendStatus === "read") === (value.actionId === null),
  { message: "Send results require their action identity" })
 .refine(value => new Set(value.messages.map(message => message.id)).size === value.messages.length,
  { message: "Provider message IDs must be unique within the observation" });
export type AlibabaObservation = z.infer<typeof alibabaObservationSchema>;
export type AlibabaStatus = "searching" | "queued" | "awaiting_reply" | "negotiating" | "attention" | "paused";
export type AlibabaMessageView = { id: string; direction: "inbound" | "outbound"; body: string; sentAt: string };
export type AlibabaActionView = { id: string; body: string; state: "pending" | "dispatching" | "sent" | "outcome_unknown" | "blocked" | "cancelled"; reason: string | null; createdAt: string };
export type AlibabaConversationView = {
  id: string; companyName: string; companyUrl: string; productUrl: string; threadUrl: string | null;
  status: AlibabaStatus; reason: string | null; retired: boolean; lastActivityAt: string | null; nextCheckAt: string | null;
  messages: AlibabaMessageView[]; actions: AlibabaActionView[];
};
export type AlibabaWorkspace = {
  enabled: boolean; status: AlibabaStatus; reason: string | null;
  lastActivityAt: string | null; nextCheckAt: string | null; conversations: AlibabaConversationView[];
};
