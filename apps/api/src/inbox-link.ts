import type { Pool } from "@forge-ops/db";
import type { InboxMessageSummary } from "@forge-ops/domain";
import { inboxSummary, readInboxBody, readInboxRecord } from "./inbox-read.ts";
export type InboxLinkResult =
  | {
      readonly kind: "linked";
      readonly message: InboxMessageSummary;
      readonly reused: boolean;
    }
  | {
      readonly kind: "error";
      readonly status: 400 | 404 | 409;
      readonly code:
        "INVALID" | "NOT_FOUND" | "ALREADY_LINKED" | "REPLY_CONFLICT";
    };
export async function linkInboxMessage(
  pool: Pool,
  key: Buffer,
  input: {
    readonly messageId: string;
    readonly rfqId: string;
    readonly actor: string;
  },
): Promise<InboxLinkResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "inbox-link:" + input.messageId,
    ]);
    const message = await readInboxRecord(client, input.messageId);
    if (!message) {
      await client.query("ROLLBACK");
      return { kind: "error", status: 404, code: "NOT_FOUND" };
    }
    if (message.classification === "linked") {
      await client.query("COMMIT");
      return message.rfq_id === input.rfqId
        ? { kind: "linked", message: inboxSummary(message), reused: true }
        : { kind: "error", status: 409, code: "ALREADY_LINKED" };
    }
    if (
      message.classification === "conflict" ||
      message.classification === "duplicate"
    ) {
      await client.query("ROLLBACK");
      return { kind: "error", status: 409, code: "REPLY_CONFLICT" };
    }
    const body = readInboxBody(message, key);
    if (
      message.body_state !== "text" ||
      !body?.trim() ||
      message.received_at === null
    ) {
      await client.query("ROLLBACK");
      return { kind: "error", status: 400, code: "INVALID" };
    }
    const messageId = message.message_id ?? "inbox:" + message.id;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "inbox.message:" + message.profile_id + ":" + messageId,
    ]);
    const peek = await client.query<{ candidate_id: string }>(
      "SELECT candidate_id FROM rfq_drafts WHERE id=$1",
      [input.rfqId],
    );
    const candidateId = peek.rows[0]?.candidate_id;
    if (!candidateId) {
      await client.query("ROLLBACK");
      return { kind: "error", status: 404, code: "NOT_FOUND" };
    }
    const candidate = await client.query<{ stage: string }>(
      "SELECT stage FROM candidates WHERE id=$1 FOR SHARE",
      [candidateId],
    );
    const drafts = await client.query<{ state: string }>(
      "SELECT state FROM rfq_drafts WHERE id=$1 FOR SHARE",
      [input.rfqId],
    );
    if (
      !candidate.rows[0] ||
      ["decision_recorded", "rejected"].includes(candidate.rows[0].stage) ||
      !["awaiting_quote", "outcome_unknown"].includes(
        drafts.rows[0]?.state ?? "",
      )
    ) {
      await client.query("ROLLBACK");
      return { kind: "error", status: 409, code: "REPLY_CONFLICT" };
    }
    const prior = await client.query<{
      id: string;
      rfq_id: string;
      body: string;
    }>(
      "SELECT id,rfq_id,body FROM supplier_replies WHERE message_id=$1 ORDER BY created_at,id LIMIT 1",
      [messageId],
    );
    let replyId = prior.rows[0]?.id;
    if (
      prior.rows[0] &&
      (prior.rows[0].rfq_id !== input.rfqId || prior.rows[0].body !== body)
    ) {
      await client.query("ROLLBACK");
      return { kind: "error", status: 409, code: "REPLY_CONFLICT" };
    }
    if (!replyId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO supplier_replies(rfq_id,source,received_at,message_id,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(rfq_id,message_id) DO NOTHING RETURNING id`,
        [
          input.rfqId,
          message.source_identity,
          message.received_at,
          messageId,
          body,
        ],
      );
      replyId = inserted.rows[0]?.id;
      if (!replyId) {
        const raced = await client.query<{ id: string; body: string }>(
          "SELECT id,body FROM supplier_replies WHERE rfq_id=$1 AND message_id=$2",
          [input.rfqId, messageId],
        );
        if (raced.rows[0]?.body !== body) {
          await client.query("ROLLBACK");
          return { kind: "error", status: 409, code: "REPLY_CONFLICT" };
        }
        replyId = raced.rows[0].id;
      }
    }
    await client.query(
      "INSERT INTO inbox_message_links(inbox_message_id,rfq_id,supplier_reply_id,linked_by) VALUES($1,$2,$3,$4)",
      [message.id, input.rfqId, replyId, input.actor],
    );
    await client.query(
      "INSERT INTO audit_events(actor,action,target,meta) VALUES($1,'inbox_reply_linked',$2,$3::jsonb)",
      [
        input.actor,
        message.id,
        JSON.stringify({ rfqId: input.rfqId, supplierReplyId: replyId }),
      ],
    );
    const linked = await readInboxRecord(client, message.id);
    if (!linked) throw new Error("Inbox association disappeared");
    await client.query("COMMIT");
    return { kind: "linked", message: inboxSummary(linked), reused: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
