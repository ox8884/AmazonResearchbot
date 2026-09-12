import { reconcileMailpit } from "./mailpit-reconcile.ts";
import { createTransport } from "nodemailer";
import type { ContactTransport } from "./transport.ts";
export function createMailpitTransport(appEnv: string): ContactTransport {
  if (appEnv !== "development")
    throw new Error("Local mail capture is development-only");
  return {
    name: "mailpit",
    reconcile: reconcileMailpit,
    async authorize(payload) {
      return payload.recipient.toLowerCase().endsWith(".invalid")
        ? { allowed: true }
        : { allowed: false, reason: "MAILPIT_SYNTHETIC_RECIPIENT_REQUIRED" };
    },
    async send(payload, actionId) {
      if (!payload.recipient.toLowerCase().endsWith(".invalid"))
        throw new Error("Synthetic recipient required");
      const messageId = `<forge-rfq-${actionId}@forge.invalid>`;
      const transport = createTransport({
        host: "127.0.0.1",
        port: 1025,
        secure: false,
        ignoreTLS: true,
        pool: false,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        const info = await transport.sendMail({
          from: {
            name: "Forge Kitchen local test",
            address: "rfq@forge.invalid",
          },
          to: payload.recipient,
          subject: payload.subject,
          text: payload.body,
          messageId,
          headers: "rfqId" in payload && typeof payload.rfqId === "string" ? { "X-Forge-RFQ-ID": payload.rfqId } : {},
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (
          info.accepted.length !== 1 ||
          info.rejected.length !== 0 ||
          info.messageId !== messageId
        )
          return { kind: "unknown", reason: "SMTP_RECEIPT_UNCONFIRMED" };
        return {
          kind: "sent",
          messageId,
          receipt: JSON.stringify({
            transport: "mailpit",
            messageId,
            accepted: true,
          }),
        };
      } catch (error) {
        if (error instanceof Error)
          return { kind: "unknown", reason: "SMTP_OUTCOME_UNKNOWN" };
        throw error;
      } finally {
        transport.close();
      }
    },
  };
}
