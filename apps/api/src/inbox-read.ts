import { readInboxStatus } from "./inbox-status.ts";
import type { Pool } from "@forge-ops/db";
import {
  inboxCaptureOwner,
  type InboxMessageSummary,
  type InboxMessageDetail,
  type InboxWorkspace,
  type InboxClassification,
  type InboxAttachmentView,
  type InboxLinkOption,
  type InboxSourceCoordinates,
} from "@forge-ops/domain";
import { decryptSecret } from "@forge-ops/security";
export type InboxConnection = Pick<Pool, "query">;

type SummaryRow = {
  readonly id: string;
  readonly subject: string | null;
  readonly from_addresses: string[];
  readonly received_at: Date | null;
  readonly created_at: Date;
  readonly classification: InboxClassification;
  readonly classification_reason: string;
  readonly candidate_id: string | null;
  readonly keyword: string | null;
  readonly rfq_id: string | null;
  readonly spec_id: string | null;
  readonly attachment_count: number;
};
export type InboxRecord = SummaryRow & {
  readonly profile_id: string;
  readonly mailbox_key: string;
  readonly uid_validity: string;
  readonly uid: string;
  readonly body_state: InboxMessageDetail["message"]["bodyState"];
  readonly body_ciphertext: string | null;
  readonly source_identity: string;
  readonly message_id: string | null;
  readonly original_available: boolean;
};
const relations = `FROM inbox_messages m JOIN inbox_mailboxes b ON b.id=m.mailbox_id
 LEFT JOIN inbox_message_links l ON l.inbox_message_id=m.id
 LEFT JOIN rfq_drafts r ON r.id=COALESCE(l.rfq_id,m.rfq_id)
 LEFT JOIN candidates c ON c.id=r.candidate_id`;
const columns = `m.id,m.subject,m.from_addresses,m.received_at,m.created_at,
 CASE WHEN l.inbox_message_id IS NOT NULL THEN 'linked' ELSE m.classification END AS classification,
 CASE WHEN l.inbox_message_id IS NOT NULL THEN 'MANUALLY_LINKED' ELSE m.classification_reason END AS classification_reason,
 c.id AS candidate_id,c.keyword_display AS keyword,r.id AS rfq_id,r.spec_id,
 (SELECT count(*)::int FROM inbox_attachments WHERE inbox_message_id=m.id) AS attachment_count`;

export function inboxSummary(row: SummaryRow): InboxMessageSummary {
  return {
    id: row.id,
    subject: row.subject,
    from: row.from_addresses,
    receivedAt: row.received_at?.toISOString() ?? null,
    collectedAt: row.created_at.toISOString(),
    classification: row.classification,
    reason: row.classification_reason,
    candidate:
      row.candidate_id !== null && row.keyword !== null
        ? { id: row.candidate_id, keyword: row.keyword }
        : null,
    rfqId: row.rfq_id,
    specId: row.spec_id,
    attachmentCount: row.attachment_count,
  };
}
export function inboxCoordinates(row: InboxRecord): InboxSourceCoordinates {
  return {
    profileId: row.profile_id,
    mailboxKey: row.mailbox_key,
    uidValidity: row.uid_validity,
    uid: row.uid,
  };
}
export function readInboxBody(row: InboxRecord, key: Buffer): string | null {
  return row.body_ciphertext === null
    ? null
    : decryptSecret(
        row.body_ciphertext,
        key,
        inboxCaptureOwner(inboxCoordinates(row), "body"),
      ).toString("utf8");
}
export async function readInboxRecord(
  db: InboxConnection,
  id: string,
): Promise<InboxRecord | null> {
  const rows = await db.query<InboxRecord>(
    `SELECT ${columns},m.profile_id,b.mailbox_key,b.uid_validity,m.uid::text,m.body_state,m.body_ciphertext,m.source_identity,m.message_id,
 (m.raw_state='captured' AND m.raw_ciphertext IS NOT NULL) AS original_available ${relations} WHERE m.id=$1`,
    [id],
  );
  return rows.rows[0] ?? null;
}
export class InboxCursorError extends Error {
  constructor() {
    super("Invalid inbox cursor");
  }
}
export async function readInboxWorkspace(
  db: InboxConnection,
  input: {
    readonly filter: "all" | "unclassified";
    readonly cursor?: string;
    readonly collectionEnabled: boolean;
  },
): Promise<InboxWorkspace> {
  if (input.cursor) {
    const found = await db.query("SELECT id FROM inbox_messages WHERE id=$1", [
      input.cursor,
    ]);
    if (!found.rowCount) throw new InboxCursorError();
  }
  const rows = await db.query<SummaryRow>(
    `SELECT ${columns} ${relations}
 WHERE m.classification<>'duplicate'
 AND ($1='all' OR (m.classification IN ('unclassified','conflict') AND l.inbox_message_id IS NULL))
 AND ($2::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM inbox_messages WHERE id=$2))
 ORDER BY m.created_at DESC,m.id DESC LIMIT 26`,
    [input.filter, input.cursor ?? null],
  );
  const status = await readInboxStatus(db, input.collectionEnabled);
  const page = rows.rows.slice(0, 25);
  return {
    ...status,
    messages: page.map(inboxSummary),
    nextCursor:
      rows.rows.length > 25 ? (page[page.length - 1]?.id ?? null) : null,
  };
}
export async function readInboxDetail(
  db: InboxConnection,
  key: Buffer,
  id: string,
): Promise<InboxMessageDetail | null> {
  const row = await readInboxRecord(db, id);
  if (!row) return null;
  const body = readInboxBody(row, key);
  const files = await db.query<{
    id: string;
    part: string;
    filename: string | null;
    media_type: string;
    byte_size: string | null;
    state: InboxAttachmentView["state"];
    text_ciphertext: string | null;
  }>(
    "SELECT id,part,filename,media_type,byte_size::text,state,text_ciphertext FROM inbox_attachments WHERE inbox_message_id=$1 ORDER BY part",
    [id],
  );
  const attachments = files.rows.map((file) => {
    const size = file.byte_size === null ? null : Number(file.byte_size);
    return {
      id: file.id,
      filename: file.filename,
      mediaType: file.media_type,
      byteSize:
        file.state === "text" &&
        size !== null &&
        Number.isSafeInteger(size) &&
        size >= 0
          ? size
          : null,
      state: file.state,
      text:
        file.state !== "text" || file.text_ciphertext === null
          ? null
          : decryptSecret(
              file.text_ciphertext,
              key,
              inboxCaptureOwner(
                inboxCoordinates(row),
                "attachment-text:" + file.part,
              ),
            ).toString("utf8"),
    };
  });
  let linkOptions: InboxLinkOption[] = [];
  if (
    row.classification === "unclassified" &&
    row.body_state === "text" &&
    body?.trim() &&
    row.received_at !== null
  ) {
    const options = await db.query<{
      rfqId: string;
      candidateId: string;
      keyword: string;
      recipient: string;
      subject: string;
      specId: string;
      quantity: number;
    }>(`SELECT r.id AS "rfqId",c.id AS "candidateId",c.keyword_display AS keyword,r.recipient,r.subject,r.spec_id AS "specId",r.quantity
   FROM rfq_drafts r JOIN candidates c ON c.id=r.candidate_id
   WHERE r.state IN ('awaiting_quote','outcome_unknown') AND c.stage NOT IN ('decision_recorded','rejected') ORDER BY r.created_at DESC,r.id`);
    linkOptions = options.rows;
  }
  return {
    message: {
      ...inboxSummary(row),
      body,
      bodyState: row.body_state,
      originalAvailable: row.original_available,
    },
    attachments,
    linkOptions,
  };
}
