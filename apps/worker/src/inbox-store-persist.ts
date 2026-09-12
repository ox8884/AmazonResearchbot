import { encryptSecret } from "@forge-ops/security";
import type { ApprovedMailProfileGrant } from "@forge-ops/integrations/mail/connection-types";
import type { InboxBatch, InboxMessage } from "@forge-ops/integrations/mail/inbox-types";
import { matchRfqReply } from "./inbox-matching.ts";
import {
  captureAad,
  receivedAt,
  sourceHash,
  type Classification,
  type QueryConnection,
} from "./inbox-store-support.ts";

type MessageRow = { readonly raw_hash: string | null };
type ReplyRow = { readonly body: string };

async function existingSource(
  db: QueryConnection,
  grant: ApprovedMailProfileGrant,
  batch: InboxBatch,
  message: InboxMessage,
  rawHash: string | null,
): Promise<MessageRow | null> {
  if (message.messageId !== null) {
    const rows = await db.query<MessageRow>(
      `SELECT raw_hash FROM inbox_messages
        WHERE profile_id=$1 AND message_id=$2 AND classification NOT IN ('duplicate','conflict')
        ORDER BY created_at,id LIMIT 1`,
      [grant.id, message.messageId],
    );
    return rows.rows[0] ?? null;
  }
  if (rawHash === null) return null;
  const rows = await db.query<MessageRow>(
    `SELECT m.raw_hash FROM inbox_messages m
      JOIN inbox_mailboxes b ON b.id=m.mailbox_id
     WHERE m.profile_id=$1 AND b.mailbox_key=$2 AND m.raw_hash=$3
     ORDER BY m.created_at,m.id LIMIT 1`,
    [grant.id, batch.mailboxKey, rawHash],
  );
  return rows.rows[0] ?? null;
}

async function classifyMessage(
  db: QueryConnection,
  grant: ApprovedMailProfileGrant,
  batch: InboxBatch,
  message: InboxMessage,
  rawHash: string | null,
): Promise<Classification> {
  const source = await existingSource(db, grant, batch, message, rawHash);
  if (source) {
    if (rawHash !== null && source.raw_hash === rawHash)
      return { kind: "duplicate", reason: "SOURCE_REPLAY", rfqId: null };
    return { kind: "conflict", reason: "SOURCE_CONTENT_CONFLICT", rfqId: null };
  }
  if (message.messageId === null)
    return { kind: "unclassified", reason: "MESSAGE_ID_MISSING", rfqId: null };
  if (message.bodyText === null || message.contentState !== "text")
    return { kind: "unclassified", reason: "BODY_UNAVAILABLE", rfqId: null };
  if (receivedAt(message.receivedAt) === null)
    return { kind: "unclassified", reason: "RECEIVED_AT_UNAVAILABLE", rfqId: null };
  const match = await matchRfqReply(db, message);
  if (match.kind === "unclassified")
    return { kind: "unclassified", reason: match.reason, rfqId: null };
  const existingReply = await db.query<ReplyRow>(
    "SELECT body FROM supplier_replies WHERE message_id=$1 ORDER BY created_at,id LIMIT 1",
    [message.messageId],
  );
  const prior = existingReply.rows[0];
  if (prior)
    return prior.body === message.bodyText
      ? { kind: "duplicate", reason: "SUPPLIER_REPLY_REPLAY", rfqId: null }
      : { kind: "conflict", reason: "SUPPLIER_REPLY_CONTENT_CONFLICT", rfqId: null };
  const reply = await db.query<{ readonly id: string }>(
    `INSERT INTO supplier_replies(rfq_id,source,received_at,message_id,body)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(rfq_id,message_id) DO NOTHING
     RETURNING id`,
    [
      match.rfqId,
      `inbox:${batch.mailboxKey}:${batch.uidValidity}:${message.uid}`,
      message.receivedAt,
      message.messageId,
      message.bodyText,
    ],
  );
  if (reply.rowCount === 1)
    return { kind: "linked", reason: "EXACT_RFQ_REFERENCE", rfqId: match.rfqId };
  const raced = await db.query<ReplyRow>(
    "SELECT body FROM supplier_replies WHERE message_id=$1 ORDER BY created_at,id LIMIT 1",
    [message.messageId],
  );
  const racedReply = raced.rows[0];
  return racedReply?.body === message.bodyText
    ? { kind: "duplicate", reason: "SUPPLIER_REPLY_REPLAY", rfqId: null }
    : { kind: "conflict", reason: "SUPPLIER_REPLY_CONTENT_CONFLICT", rfqId: null };
}

async function storeAttachments(
  db: QueryConnection,
  inboxMessageId: string,
  grant: ApprovedMailProfileGrant,
  batch: InboxBatch,
  message: InboxMessage,
  key: Buffer,
): Promise<void> {
  for (const attachment of message.attachments) {
    await db.query(
      `INSERT INTO inbox_attachments(inbox_message_id,part,filename,media_type,byte_size,state,bytes_ciphertext,text_ciphertext)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        inboxMessageId, attachment.part, attachment.filename, attachment.mediaType, attachment.size, attachment.state,
        attachment.bytes === null ? null : encryptSecret(Buffer.from(attachment.bytes), key, captureAad(grant, batch, message, `attachment:${attachment.part}`)),
        attachment.text === null ? null : encryptSecret(Buffer.from(attachment.text, "utf8"), key, captureAad(grant, batch, message, `attachment-text:${attachment.part}`)),
      ],
    );
  }
}

export async function persistInboxMessage(
  db: QueryConnection,
  namespaceId: string,
  grant: ApprovedMailProfileGrant,
  batch: InboxBatch,
  message: InboxMessage,
  key: Buffer,
): Promise<{ readonly stored: boolean; readonly classification: Classification }> {
  const alreadyStored = await db.query("SELECT id FROM inbox_messages WHERE mailbox_id=$1 AND uid=$2", [namespaceId, message.uid]);
  if (alreadyStored.rowCount === 1)
    return { stored: false, classification: { kind: "duplicate", reason: "UID_REPLAY", rfqId: null } };
  const raw = message.rawSource;
  const rawHash = raw === null ? null : sourceHash(raw);
  const classification = await classifyMessage(db, grant, batch, message, rawHash);
  const inserted = await db.query<{ readonly id: string }>(
    `INSERT INTO inbox_messages(
       mailbox_id,profile_id,uid,source_identity,message_id,in_reply_to_ids,reference_ids,
       from_addresses,to_addresses,subject,received_at_source,received_at,raw_state,raw_hash,
       raw_ciphertext,body_state,body_ciphertext,classification,classification_reason,rfq_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [
      namespaceId, grant.id, message.uid, `inbox:${batch.mailboxKey}:${batch.uidValidity}:${message.uid}`,
      message.messageId, [...message.inReplyTo], [...message.references], [...message.from], [...message.to], message.subject,
      message.receivedAt, receivedAt(message.receivedAt), raw === null ? "missing" : "captured", rawHash,
      raw === null ? null : encryptSecret(Buffer.from(raw), key, captureAad(grant, batch, message, "raw")),
      message.contentState, message.bodyText === null ? null : encryptSecret(Buffer.from(message.bodyText, "utf8"), key, captureAad(grant, batch, message, "body")),
      classification.kind, classification.reason, classification.rfqId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("Inbox message insert did not return an id");
  await storeAttachments(db, row.id, grant, batch, message, key);
  return { stored: true, classification };
}
