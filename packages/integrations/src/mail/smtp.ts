import { rejectedBeforeData } from "./smtp-failure.ts";
import type {
  ApprovedMailProfileGrant,
  ImapClient,
  MailConnectorDependencies,
  MailProfileAccess,
  SmtpClient,
} from "./connection-types.ts";
import type { ContactTransport, MailReceipt } from "./transport.ts";
import {
  current,
  prepareConnection,
  smtpClient,
  imapClient,
  type PreparedConnection,
} from "./connection.ts";
import {
  MAIL_TRANSPORT_NAME,
  messageIdFor,
  receipt,
  receivedExactlyOne,
  matchesSentMessage,
} from "./receipt.ts";
async function logout(client: ImapClient | null): Promise<void> {
  if (!client) return;
  try {
    await client.logout();
  } catch {
    return;
  }
}

function notSent(
  prepared: Exclude<PreparedConnection, { readonly kind: "ready" }>,
): MailReceipt {
  switch (prepared.kind) {
    case "profile_changed":
      return { kind: "not_sent", reason: "MAIL_PROFILE_CHANGED" };
    case "target_denied":
      return { kind: "not_sent", reason: "MAIL_SMTP_TARGET_DENIED" };
    case "password_unavailable":
      return { kind: "not_sent", reason: "MAIL_SMTP_CREDENTIALS_UNAVAILABLE" };
  }
}

export function createSmtpImapTransport(
  grant: ApprovedMailProfileGrant,
  access: MailProfileAccess,
  dependencies: MailConnectorDependencies = {},
): ContactTransport {
  return {
    name: MAIL_TRANSPORT_NAME,
    async authorize() {
      const prepared = await prepareConnection(
        grant,
        access,
        dependencies,
        "smtp",
      );
      if (prepared.kind === "profile_changed")
        return { allowed: false, reason: "MAIL_PROFILE_CHANGED" };
      if (prepared.kind === "target_denied")
        return { allowed: false, reason: "MAIL_SMTP_TARGET_DENIED" };
      if (prepared.kind === "password_unavailable")
        return { allowed: false, reason: "MAIL_SMTP_CREDENTIALS_UNAVAILABLE" };
      let client: SmtpClient | null = null;
      try {
        client = smtpClient(
          grant,
          prepared.target,
          prepared.password,
          dependencies,
        );
        await client.verify();
        return { allowed: true };
      } catch (error) {
        const reason = await rejectedBeforeData(error, grant, access);
        return {
          allowed: false,
          reason: reason ?? "MAIL_SMTP_PRECHECK_FAILED",
        };
      } finally {
        client?.close();
      }
    },
    async send(payload, actionId) {
      const prepared = await prepareConnection(
        grant,
        access,
        dependencies,
        "smtp",
      );
      if (prepared.kind !== "ready") return notSent(prepared);
      let client: SmtpClient | null = null;
      try {
        client = smtpClient(
          grant,
          prepared.target,
          prepared.password,
          dependencies,
        );
      } catch {
        return { kind: "not_sent", reason: "MAIL_SMTP_CLIENT_UNAVAILABLE" };
      }
      try {
        if (!(await current(grant, access)))
          return { kind: "not_sent", reason: "MAIL_PROFILE_CHANGED" };
        const messageId = messageIdFor(actionId, grant.config.sender);
        const info = await client.sendMail({
          from: grant.config.sender,
          to: payload.recipient,
          subject: payload.subject,
          text: payload.body,
          textEncoding: "base64",
          messageId,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (!receivedExactlyOne(info, messageId, payload.recipient))
          return { kind: "unknown", reason: "SMTP_RECEIPT_UNCONFIRMED" };
        return receipt(messageId, false);
      } catch (error) {
        const reason = await rejectedBeforeData(error, grant, access);
        return reason
          ? { kind: "not_sent", reason }
          : { kind: "unknown", reason: "SMTP_OUTCOME_UNKNOWN" };
      } finally {
        client.close();
      }
    },
    async reconcile(payload, actionId) {
      const prepared = await prepareConnection(
        grant,
        access,
        dependencies,
        "imap",
      );
      if (prepared.kind !== "ready") return null;
      let client: ImapClient | null = null;
      let lock: { readonly release: () => void } | null = null;
      try {
        client = imapClient(
          grant,
          prepared.target,
          prepared.password,
          dependencies,
        );
        if (!(await current(grant, access))) return null;
        await client.connect();
        lock = await client.getMailboxLock(grant.config.sentMailbox, {
          readOnly: true,
        });
        const messageId = messageIdFor(actionId, grant.config.sender);
        const matches = await client.searchExactMessageId(messageId);
        if (matches.length !== 1) return null;
        const uid = matches[0];
        if (uid === undefined) return null;
        const message = await client.fetchSentMessage(uid);
        if (
          !message ||
          !matchesSentMessage(message, payload, grant.config.sender, messageId)
        )
          return null;
        return receipt(messageId, true);
      } catch {
        return null;
      } finally {
        lock?.release();
        await logout(client);
      }
    },
  };
}
