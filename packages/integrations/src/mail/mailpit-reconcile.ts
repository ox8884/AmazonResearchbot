import type { MailMessage } from "./transport.ts";
import type { MailReceipt } from "./transport.ts";
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export async function reconcileMailpit(
  payload: MailMessage,
  actionId: string,
): Promise<MailReceipt | null> {
  if (!payload.recipient.toLowerCase().endsWith(".invalid")) return null;
  const messageId = `forge-rfq-${actionId}@forge.invalid`;
  const response = await fetch(
    "http://127.0.0.1:8025/api/v1/search?query=" +
      encodeURIComponent(payload.subject) +
      "&limit=50",
    { signal: AbortSignal.timeout(5000), redirect: "error" },
  );
  if (!response.ok) return null;
  const data: unknown = await response.json();
  if (!record(data) || !Array.isArray(data.messages)) return null;
  const item = data.messages.find(
    (value: unknown) =>
      record(value) &&
      value.MessageID === messageId &&
      typeof value.ID === "string",
  );
  if (!record(item) || typeof item.ID !== "string") return null;
  const detail = await fetch(
    "http://127.0.0.1:8025/api/v1/message/" + encodeURIComponent(item.ID),
    { signal: AbortSignal.timeout(5000), redirect: "error" },
  );
  if (!detail.ok) return null;
  const message: unknown = await detail.json();
  if (
    !record(message) ||
    message.MessageID !== messageId ||
    message.Subject !== payload.subject ||
    typeof message.Text !== "string" ||
    !record(message.From) ||
    message.From.Address !== "rfq@forge.invalid" ||
    !Array.isArray(message.To) ||
    message.To.length !== 1 ||
    !record(message.To[0]) ||
    message.To[0].Address !== payload.recipient ||
    !Array.isArray(message.Cc) ||
    message.Cc.length ||
    !Array.isArray(message.Bcc) ||
    message.Bcc.length
  )
    return null;
  const actual = message.Text.replace(/\r\n/g, "\n"),
    expected = payload.body.replace(/\r\n/g, "\n");
  if (actual !== expected && actual !== expected + "\n") return null;
  return {
    kind: "sent",
    messageId: "<" + messageId + ">",
    receipt: JSON.stringify({
      transport: "mailpit",
      messageId: "<" + messageId + ">",
      accepted: true,
      reconciled: true,
    }),
  };
}
