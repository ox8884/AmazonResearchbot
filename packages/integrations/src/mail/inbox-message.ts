import type { FetchMessageObject, FetchQueryObject } from "imapflow";
import type { ImapInboxClient } from "./inbox-client.ts";
import type { InboxAttachment, InboxMessage } from "./inbox-types.ts";
import {
  decodeTextPart,
  planMessageParts,
  readThreadHeaders,
  MAX_INBOX_SOURCE_BYTES,
  MAX_INBOX_TEXT_BYTES,
  type DecodedText,
  type MailPart,
} from "./inbox-content.ts";

export class InboxProfileChanged extends Error {
  constructor() {
    super("MAIL_PROFILE_CHANGED");
  }
}
function dateText(value: Date | string | undefined): string | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function metadata(
  uid: number,
  message: FetchMessageObject | false,
): InboxMessage {
  if (!message)
    return {
      uid,
      messageId: null,
      inReplyTo: [],
      references: [],
      from: [],
      to: [],
      subject: null,
      receivedAt: null,
      rawSource: null,
      bodyText: null,
      contentState: "missing",
      attachments: [],
    };
  const headers = message.headers ? readThreadHeaders(message.headers) : null;
  return {
    uid,
    messageId: headers?.messageId ?? null,
    inReplyTo: headers?.inReplyTo ?? [],
    references: headers?.references ?? [],
    from: (message.envelope?.from ?? []).flatMap((address) =>
      typeof address.address === "string" ? [address.address] : [],
    ),
    to: (message.envelope?.to ?? []).flatMap((address) =>
      typeof address.address === "string" ? [address.address] : [],
    ),
    subject: message.envelope?.subject ?? null,
    receivedAt: dateText(message.internalDate),
    rawSource: null,
    bodyText: null,
    contentState: "unreadable",
    attachments: [],
  };
}

export async function fetchInboxMessage(
  client: ImapInboxClient,
  uid: number,
  isCurrent: () => Promise<boolean>,
): Promise<InboxMessage> {
  async function fetch(
    query: FetchQueryObject,
  ): Promise<FetchMessageObject | false> {
    if (!(await isCurrent())) throw new InboxProfileChanged();
    const result = await client.fetch(uid, query);
    if (result && result.uid !== uid)
      throw new Error("MAIL_INBOX_UID_MISMATCH");
    return result;
  }
  const meta = await fetch({
    envelope: true,
    size: true,
    internalDate: true,
    bodyStructure: true,
    headers: ["message-id", "in-reply-to", "references"],
  });
  const base = metadata(uid, meta);
  if (!meta) return base;
  if (
    meta.size === undefined ||
    !Number.isSafeInteger(meta.size) ||
    meta.size < 0
  )
    return base;
  if (meta.size > MAX_INBOX_SOURCE_BYTES)
    return { ...base, contentState: "too_large" };
  const source = await fetch({
    source: { start: 0, maxLength: MAX_INBOX_SOURCE_BYTES + 1 },
  });
  if (
    !source ||
    !source.source ||
    source.source.byteLength > MAX_INBOX_SOURCE_BYTES ||
    source.source.byteLength !== meta.size
  )
    return base;
  const original = { ...base, rawSource: source.source };
  const parts = planMessageParts(meta.bodyStructure);
  if (!parts.complete) return original;
  async function readPart(part: MailPart): Promise<DecodedText> {
    if (part.size !== null && part.size > MAX_INBOX_SOURCE_BYTES)
      return { kind: "too_large" };
    const result = await fetch({
      bodyParts: [
        { key: part.key, start: 0, maxLength: MAX_INBOX_SOURCE_BYTES + 1 },
      ],
    });
    const key = part.key.toLowerCase();
    const bytes = result ? result.bodyParts?.get(key) : undefined;
    if (!bytes) return { kind: "unreadable" };
    const binaryDecoded =
      result !== false && result.binaryParts?.has(key) === true;
    if (!binaryDecoded && part.size !== null && bytes.byteLength !== part.size)
      return { kind: "unreadable" };
    return decodeTextPart(bytes, {
      encoding: part.encoding,
      charset: part.charset,
      binaryDecoded,
    });
  }
  const texts: string[] = [];
  let state: InboxMessage["contentState"] = parts.body.length
    ? "text"
    : "unsupported";
  for (const part of parts.body) {
    const decoded = await readPart(part);
    if (decoded.kind === "text") texts.push(decoded.text);
    else state = decoded.kind;
  }
  const attachments: InboxAttachment[] = [];
  for (const part of parts.attachments) {
    const fields = {
      part: part.key,
      filename: part.filename,
      mediaType: part.mediaType,
      size: part.size,
    };
    if (!part.supported) {
      attachments.push({
        ...fields,
        size: null,
        state: "unsupported",
        bytes: null,
        text: null,
      });
      continue;
    }
    const decoded = await readPart(part);
    attachments.push(
      decoded.kind === "text"
        ? {
            ...fields,
            size: decoded.bytes.byteLength,
            state: "text",
            bytes: decoded.bytes,
            text: decoded.text,
          }
        : {
            ...fields,
            size: null,
            state: decoded.kind,
            bytes: null,
            text: null,
          },
    );
  }
  const text = texts.join("\n\n");
  if (Buffer.byteLength(text, "utf8") > MAX_INBOX_TEXT_BYTES)
    state = "too_large";
  return {
    ...original,
    bodyText: state === "text" ? text : null,
    contentState: state,
    attachments,
  };
}
