import type { MessageStructureObject } from "imapflow";

export const MAX_INBOX_SOURCE_BYTES = 256 * 1024;
export const MAX_INBOX_TEXT_BYTES = 64 * 1024;

export type ThreadHeaders = {
  readonly messageId: string | null;
  readonly inReplyTo: readonly string[];
  readonly references: readonly string[];
};

export function readThreadHeaders(bytes: Uint8Array): ThreadHeaders | null {
  if (bytes.byteLength > 16 * 1024) return null;
  const text = Buffer.from(bytes)
    .toString("latin1")
    .replace(/\r?\n[ \t]+/g, " ");
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1) return null;
    const key = line.slice(0, colon).toLowerCase();
    if (!["message-id", "in-reply-to", "references"].includes(key)) continue;
    if (values.has(key)) return null;
    values.set(key, line.slice(colon + 1).trim());
  }
  const fields = new Map<string, readonly string[]>();
  for (const [key, value] of values) {
    const ids = value.match(/<[^<>\s\x00-\x20\x7f-\xff]+>/g) ?? [];
    if (
      ids.length > 32 ||
      value.replace(/<[^<>\s\x00-\x20\x7f-\xff]+>/g, "").trim()
    )
      return null;
    if (key === "message-id" && ids.length !== 1) return null;
    fields.set(key, [...new Set(ids)]);
  }
  return {
    messageId: fields.get("message-id")?.[0] ?? null,
    inReplyTo: fields.get("in-reply-to") ?? [],
    references: fields.get("references") ?? [],
  };
}

type TextEncoding = {
  readonly encoding?: string;
  readonly charset?: string;
  readonly binaryDecoded?: boolean;
};
export type DecodedText =
  | { readonly kind: "text"; readonly bytes: Uint8Array; readonly text: string }
  | { readonly kind: "unreadable" | "too_large" };

export function decodeTextPart(
  input: Uint8Array,
  options: TextEncoding,
): DecodedText {
  if (input.byteLength > MAX_INBOX_SOURCE_BYTES) return { kind: "too_large" };
  let bytes = Buffer.from(input);
  if (!options.binaryDecoded) {
    switch ((options.encoding ?? "7bit").toLowerCase()) {
      case "base64": {
        const encoded = bytes.toString("latin1").replace(/[\r\n\t ]/g, "");
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            encoded,
          )
        )
          return { kind: "unreadable" };
        bytes = Buffer.from(encoded, "base64");
        if (bytes.toString("base64") !== encoded) return { kind: "unreadable" };
        break;
      }
      case "quoted-printable": {
        const encoded = bytes.toString("latin1").replace(/=\r?\n/g, "");
        if (/=(?![0-9a-fA-F]{2})/.test(encoded)) return { kind: "unreadable" };
        bytes = Buffer.from(
          encoded.replace(/=([0-9a-fA-F]{2})/g, (_match, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
          ),
          "latin1",
        );
        break;
      }
      case "7bit":
        if (bytes.some((value) => value > 127)) return { kind: "unreadable" };
        break;
      case "8bit":
      case "binary":
        break;
      default:
        return { kind: "unreadable" };
    }
  }
  if (bytes.byteLength > MAX_INBOX_TEXT_BYTES) return { kind: "too_large" };
  try {
    const text = new TextDecoder(options.charset ?? "utf-8", {
      fatal: true,
    }).decode(bytes);
    if (text.includes("\0")) return { kind: "unreadable" };
    return { kind: "text", bytes, text };
  } catch {
    return { kind: "unreadable" };
  }
}

export type MailPart = {
  readonly key: string;
  readonly mediaType: string;
  readonly filename: string | null;
  readonly encoding: string | undefined;
  readonly charset: string | undefined;
  readonly size: number | null;
  readonly supported: boolean;
};
export type MessageParts = {
  readonly body: readonly MailPart[];
  readonly attachments: readonly MailPart[];
  readonly complete: boolean;
};

export function planMessageParts(
  structure: MessageStructureObject | undefined,
): MessageParts {
  if (!structure) return { body: [], attachments: [], complete: false };
  const body: MailPart[] = [],
    attachments: MailPart[] = [];
  const pending = [{ node: structure, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    const { node, depth } = entry;
    if (++visited > 64 || depth > 12)
      return { body: [], attachments: [], complete: false };
    const mediaType = node.type.toLowerCase();
    if (mediaType.startsWith("multipart/")) {
      if (!node.childNodes || node.childNodes.length > 32)
        return { body: [], attachments: [], complete: false };
      for (const child of [...node.childNodes].reverse())
        pending.push({ node: child, depth: depth + 1 });
      continue;
    }
    const key = node.part ?? (depth === 0 ? "TEXT" : "");
    if (key !== "TEXT" && !/^\d+(?:\.\d+)*$/.test(key))
      return { body: [], attachments: [], complete: false };
    const filename =
      node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
    const attachment =
      node.disposition?.toLowerCase() === "attachment" ||
      filename !== null ||
      mediaType === "message/rfc822";
    const part: MailPart = {
      key,
      mediaType,
      filename,
      encoding: node.encoding,
      charset: node.parameters?.charset,
      size:
        typeof node.size === "number" &&
        Number.isSafeInteger(node.size) &&
        node.size >= 0
          ? node.size
          : null,
      supported: attachment
        ? filename !== null &&
          /\.(txt|csv)$/i.test(filename) &&
          ["text/plain", "text/csv"].includes(mediaType)
        : mediaType === "text/plain",
    };
    if (attachment) attachments.push(part);
    else if (mediaType === "text/plain") body.push(part);
  }
  return { body, attachments, complete: true };
}
