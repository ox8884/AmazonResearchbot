import {
  ImapFlow,
  type FetchMessageObject,
  type FetchQueryObject,
  type ImapFlowOptions,
} from "imapflow";

export type InboxMailbox = {
  readonly uidValidity: string;
  readonly uidNext: number;
  readonly release: () => void;
};
export type ImapInboxClient = {
  readonly connect: () => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly close: () => void;
  readonly openReadOnly: (mailbox: string) => Promise<InboxMailbox>;
  readonly searchAfter: (
    lastUid: number,
    since?: Date,
  ) => Promise<readonly number[]>;
  readonly fetch: (
    uid: number,
    query: FetchQueryObject,
  ) => Promise<FetchMessageObject | false>;
};
export type InboxClientFactory = (options: ImapFlowOptions) => ImapInboxClient;

export function createImapInboxClient(
  options: ImapFlowOptions,
): ImapInboxClient {
  const client = new ImapFlow(options);
  let failed = false;
  client.on("error", () => {
    failed = true;
    client.close();
  });
  return {
    connect: async () => {
      await client.connect();
    },
    logout: async () => {
      if (!failed) await client.logout();
    },
    close: () => {
      failed = true;
      client.close();
    },
    async openReadOnly(mailbox) {
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      if (!client.mailbox || client.mailbox.readOnly !== true) {
        lock.release();
        throw new Error("MAIL_INBOX_READONLY_REQUIRED");
      }
      return {
        uidValidity: client.mailbox.uidValidity.toString(),
        uidNext: client.mailbox.uidNext,
        release: () => lock.release(),
      };
    },
    async searchAfter(lastUid, since) {
      if (failed || !client.mailbox)
        throw new Error("MAIL_INBOX_CONNECTION_FAILED");
      const found = await client.search(
        { uid: String(lastUid + 1) + ":*", ...(since ? { since } : {}) },
        { uid: true },
      );
      if (found === false || failed || !client.mailbox)
        throw new Error("MAIL_INBOX_SEARCH_FAILED");
      return found;
    },
    async fetch(uid, query) {
      if (failed || !client.mailbox)
        throw new Error("MAIL_INBOX_CONNECTION_FAILED");
      const result = await client.fetchOne(uid, query, {
        uid: true,
        binary: false,
      });
      if (failed || !client.mailbox)
        throw new Error("MAIL_INBOX_CONNECTION_FAILED");
      return result;
    },
  };
}
