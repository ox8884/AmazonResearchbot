import type { MailMessage } from "./transport.ts";
import type { ImapSentMessage } from "./connection-types.ts";
import type { MailReceipt } from "./transport.ts";
export const MAX_SENT_SOURCE_BYTES = 256 * 1024;
export const MAIL_TRANSPORT_NAME = "smtp-imap";
type ParsedTextSource = {
  readonly messageId: string;
  readonly text: string;
};

export function messageIdFor(actionId: string, sender: string): string {
  const at = sender.lastIndexOf("@");
  const domain = at >= 0 ? sender.slice(at + 1).toLowerCase() : "invalid";
  return `<forge-rfq-${actionId}@${domain}>`;
}

export function receipt(messageId: string, reconciled: boolean): MailReceipt {
  return {
    kind: "sent",
    messageId,
    receipt: JSON.stringify({
      transport: MAIL_TRANSPORT_NAME,
      messageId,
      ...(reconciled ? { reconciled: true } : { accepted: true }),
    }),
  };
}

export function receivedExactlyOne(
  info: { readonly accepted: readonly string[]; readonly rejected: readonly string[]; readonly messageId: string },
  messageId: string,
  recipient: string,
): boolean {
  return (
    sameAddress(info.accepted[0] ?? "", recipient) &&
    info.accepted.length === 1 &&
    info.rejected.length === 0 &&
    info.messageId === messageId
  );
}

function normalizeFinalCrLf(value: string): string {
  return value.endsWith("\r\n") ? value.slice(0, -2) : value;
}

function readHeaders(source: Buffer): { readonly headers: readonly string[]; readonly body: Buffer } | null {
  const delimiter = Buffer.from("\r\n\r\n", "ascii");
  const bodyStart = source.indexOf(delimiter);
  if (bodyStart < 0) return null;
  const lines = source
    .subarray(0, bodyStart)
    .toString("latin1")
    .split("\r\n");
  const headers: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      const previous = headers.pop();
      if (previous === undefined) return null;
      headers.push(`${previous} ${line.trim()}`);
      continue;
    }
    headers.push(line);
  }
  return { headers, body: source.subarray(bodyStart + delimiter.length) };
}

function singleHeader(
  headers: readonly string[],
  expectedName: string,
): string | null {
  let value: string | null = null;
  for (const header of headers) {
    const separator = header.indexOf(":");
    if (separator <= 0) return null;
    const name = header.slice(0, separator).trim().toLowerCase();
    if (name !== expectedName) continue;
    if (value !== null) return null;
    value = header.slice(separator + 1).trim();
  }
  return value;
}

function parseTextSource(source: Buffer): ParsedTextSource | null {
  const parsed = readHeaders(source);
  if (!parsed) return null;
  const messageId = singleHeader(parsed.headers, "message-id");
  const contentType = singleHeader(parsed.headers, "content-type");
  const encoding = singleHeader(parsed.headers, "content-transfer-encoding");
  if (
    !messageId ||
    !contentType ||
    !encoding ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "text/plain" ||
    encoding.toLowerCase() !== "base64"
  )
    return null;
  const encoded = parsed.body.toString("ascii").replace(/[\r\n\t ]/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    return null;
  try {
    return {
      messageId,
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(encoded, "base64"),
      ),
    };
  } catch {
    return null;
  }
}

function sameAddress(left: string, right: string): boolean {
  const leftAt = left.lastIndexOf("@"), rightAt = right.lastIndexOf("@");
  return leftAt > 0 && rightAt > 0 && left.slice(0, leftAt) === right.slice(0, rightAt)
    && left.slice(leftAt + 1).toLowerCase() === right.slice(rightAt + 1).toLowerCase();
}

export function matchesSentMessage(
  message: ImapSentMessage,
  payload: MailMessage,
  sender: string,
  messageId: string,
): boolean {
  const source = message.source && message.source.length <= MAX_SENT_SOURCE_BYTES ? parseTextSource(message.source) : null;
  return (
    message.from.length === 1 &&
    message.to.length === 1 &&
    sameAddress(message.from[0] ?? "", sender) &&
    sameAddress(message.to[0] ?? "", payload.recipient) &&
    message.subject === payload.subject &&
    source?.messageId === messageId &&
    source.text !== undefined &&
    normalizeFinalCrLf(source.text) === normalizeFinalCrLf(payload.body)
  );
}
