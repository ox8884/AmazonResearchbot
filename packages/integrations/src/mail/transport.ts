import type { ContactApprovalPayload } from "@forge-ops/domain";
export type MailReceipt =
  | { kind: "sent"; messageId: string; receipt: string }
  | { kind: "unknown"; reason: string }
  | { kind: "not_sent"; reason: string };
export type MailMessage = Pick<ContactApprovalPayload, "recipient" | "subject" | "body">;
export type MailTransport = {
  name: string;
  reconcile?: (
    payload: MailMessage,
    actionId: string,
  ) => Promise<MailReceipt | null>;
  authorize: (
    payload: MailMessage,
  ) => Promise<{ allowed: true } | { allowed: false; reason: string }>;
  send: (
    payload: MailMessage,
    actionId: string,
  ) => Promise<MailReceipt>;
};

export type ContactTransport = MailTransport;
