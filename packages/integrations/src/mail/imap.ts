import { MAX_SENT_SOURCE_BYTES } from "./receipt.ts";
import { ImapFlow } from "imapflow";
import type {
  ImapFlowOptions,
  MessageAddressObject,
} from "imapflow";
import type {
  ImapClient,
  ImapMailboxLock,
  ImapSentMessage,
} from "./connection-types.ts";

function envelopeAddresses(
  addresses: readonly MessageAddressObject[] | undefined,
): readonly string[] {
  if (!addresses) return [];
  const result: string[] = [];
  for (const address of addresses) {
    if (typeof address.address === "string") result.push(address.address);
  }
  return result;
}

function mailboxLock(lock: { readonly release: () => void }): ImapMailboxLock {
  return { release: () => lock.release() };
}

export function createImapClient(options: ImapFlowOptions): ImapClient {
  const client = new ImapFlow(options);
  let failed = false;
  client.on("error", () => { failed = true; client.close(); });
  return {
    connect: async () => { if (failed) throw new Error("IMAP_CONNECTION_FAILED"); await client.connect(); },
    logout: async () => { if (!failed) await client.logout(); },
    async getMailboxLock(mailbox, lockOptions) {
      const lock = await client.getMailboxLock(mailbox, lockOptions);
      return mailboxLock(lock);
    },
    async searchExactMessageId(messageId) {
      const matches = await client.search(
        { header: { "message-id": messageId } },
        { uid: true },
      );
      return matches === false ? [] : matches;
    },
    async fetchSentMessage(uid): Promise<ImapSentMessage | null> {
      const message = await client.fetchOne(
        uid,
        { envelope: true, size: true },
        { uid: true },
      );
      if (message === false || !message.envelope || message.size === undefined || message.size > MAX_SENT_SOURCE_BYTES || message.size < 0) return null;
      const raw = await client.fetchOne(uid, { source: { start: 0, maxLength: MAX_SENT_SOURCE_BYTES + 1 } }, { uid: true });
      if (!raw || !raw.source || raw.source.length > MAX_SENT_SOURCE_BYTES) return null;
      return {
        from: envelopeAddresses(message.envelope.from),
        to: envelopeAddresses(message.envelope.to),
        subject: message.envelope.subject ?? null,
        source: raw.source,
      };
    },
  };
}
