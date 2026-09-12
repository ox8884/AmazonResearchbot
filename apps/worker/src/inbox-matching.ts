import type { Pool } from "@forge-ops/db";
import type { InboxMessage } from "@forge-ops/integrations/mail/inbox-types";

type QueryConnection = Pick<Pool, "query">;

type ActionRow = {
  readonly rfq_id: string;
  readonly receipt: string;
  readonly recipient: string;
};

export type RfqMatch =
  | { readonly kind: "linked"; readonly rfqId: string }
  | { readonly kind: "unclassified"; readonly reason: string };

function persistedMessageId(receipt: string): string | null {
  try {
    const parsed: unknown = JSON.parse(receipt);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !("messageId" in parsed) ||
      typeof parsed.messageId !== "string" ||
      parsed.messageId.length === 0
    )
      return null;
    return parsed.messageId;
  } catch {
    return null;
  }
}

function exactAddress(actual: string, expected: string): boolean {
  const actualAt = actual.lastIndexOf("@");
  const expectedAt = expected.lastIndexOf("@");
  return (
    actualAt > 0 &&
    expectedAt > 0 &&
    actual.slice(0, actualAt) === expected.slice(0, expectedAt) &&
    actual.slice(actualAt + 1).toLowerCase() ===
      expected.slice(expectedAt + 1).toLowerCase()
  );
}

export async function matchRfqReply(
  db: QueryConnection,
  message: Pick<InboxMessage, "inReplyTo" | "references" | "from">,
): Promise<RfqMatch> {
  if (message.from.length !== 1)
    return { kind: "unclassified", reason: "FROM_AMBIGUOUS" };
  const referenceIds = new Set([...message.inReplyTo, ...message.references]);
  if (referenceIds.size === 0)
    return { kind: "unclassified", reason: "NO_EXACT_RFQ_REFERENCE" };
  const actions = await db.query<ActionRow>(
    `SELECT a.rfq_id,a.receipt,r.recipient
       FROM external_actions a
       JOIN rfq_drafts r ON r.id=a.rfq_id
       JOIN candidates c ON c.id=r.candidate_id
      WHERE a.state='sent' AND a.receipt IS NOT NULL
        AND r.state='awaiting_quote'
        AND c.stage NOT IN ('decision_recorded','rejected')
      FOR SHARE OF a,r,c`,
  );
  const references = actions.rows.filter((action) => {
    const messageId = persistedMessageId(action.receipt);
    return messageId !== null && referenceIds.has(messageId);
  });
  if (references.length === 0)
    return { kind: "unclassified", reason: "NO_ELIGIBLE_RFQ" };
  if (references.length !== 1)
    return { kind: "unclassified", reason: "AMBIGUOUS_RFQ_REFERENCE" };
  const match = references[0];
  if (!match) return { kind: "unclassified", reason: "NO_ELIGIBLE_RFQ" };
  if (!exactAddress(message.from[0] ?? "", match.recipient))
    return { kind: "unclassified", reason: "FROM_MISMATCH" };
  return { kind: "linked", rfqId: match.rfq_id };
}
