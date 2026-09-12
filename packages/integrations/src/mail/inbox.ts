import { exactPayloadHash, type HostResolver } from "@forge-ops/security";
import type {
  ApprovedMailProfileGrant,
  MailProfileAccess,
} from "./connection-types.ts";
import type { InboxMessage, InboxTransport } from "./inbox-types.ts";
import { current, imapOptions, prepareConnection } from "./connection.ts";
import {
  createImapInboxClient,
  type ImapInboxClient,
  type InboxClientFactory,
  type InboxMailbox,
} from "./inbox-client.ts";
import { fetchInboxMessage, InboxProfileChanged } from "./inbox-message.ts";

const BATCH_SIZE = 20;
const MAX_UID = 4_294_967_295;
export type InboxConnectorOptions = {
  readonly resolveHost?: HostResolver;
  readonly createClient?: InboxClientFactory;
  readonly initialSince?: Date;
};

export function createImapInboxTransport(
  grant: ApprovedMailProfileGrant,
  access: MailProfileAccess,
  options: InboxConnectorOptions = {},
): InboxTransport {
  const mailboxKey = exactPayloadHash({
    imapHost: grant.config.imapHost,
    imapPort: grant.config.imapPort,
    username: grant.config.username,
    mailbox: grant.config.inboxMailbox,
  });
  return {
    mailboxKey,
    async read(cursor) {
      const prepared = await prepareConnection(grant, access, options, "imap");
      if (prepared.kind === "profile_changed")
        return { kind: "blocked", reason: "MAIL_PROFILE_CHANGED" };
      if (prepared.kind === "target_denied")
        return { kind: "blocked", reason: "MAIL_IMAP_TARGET_DENIED" };
      if (prepared.kind === "password_unavailable")
        return { kind: "blocked", reason: "MAIL_IMAP_CREDENTIALS_UNAVAILABLE" };
      let client: ImapInboxClient | null = null;
      let mailbox: InboxMailbox | null = null;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const authorized = () => current(grant, access);
      try {
        client = (options.createClient ?? createImapInboxClient)(
          imapOptions(grant, prepared.target, prepared.password),
        );
        const connection = client;
        timeout = setTimeout(() => {
          timedOut = true;
          connection.close();
        }, 45_000);
        if (!(await authorized()))
          return { kind: "blocked", reason: "MAIL_PROFILE_CHANGED" };
        await client.connect();
        if (!(await authorized()))
          return { kind: "blocked", reason: "MAIL_PROFILE_CHANGED" };
        mailbox = await client.openReadOnly(grant.config.inboxMailbox);
        if (
          !/^[0-9]{1,10}$/.test(mailbox.uidValidity) ||
          Number(mailbox.uidValidity) < 1 ||
          Number(mailbox.uidValidity) > MAX_UID ||
          !Number.isSafeInteger(mailbox.uidNext) ||
          mailbox.uidNext < 1 ||
          mailbox.uidNext > MAX_UID
        )
          return { kind: "blocked", reason: "MAIL_INBOX_IDENTITY_UNKNOWN" };
        const uidValidity = String(Number(mailbox.uidValidity));
        const lastUid =
          cursor?.uidValidity === uidValidity ? cursor.lastUid : 0;
        if (
          !Number.isSafeInteger(lastUid) ||
          lastUid < 0 ||
          lastUid >= mailbox.uidNext
        )
          return { kind: "blocked", reason: "MAIL_INBOX_CURSOR_INVALID" };
        if (!(await authorized()))
          return { kind: "blocked", reason: "MAIL_PROFILE_CHANGED" };
        const found =
          lastUid < mailbox.uidNext - 1
            ? await client.searchAfter(
                lastUid,
                lastUid === 0 ? options.initialSince : undefined,
              )
            : [];
        if (
          found.some(
            (uid) => !Number.isSafeInteger(uid) || uid < 1 || uid > MAX_UID,
          )
        )
          return { kind: "blocked", reason: "MAIL_INBOX_IDENTITY_UNKNOWN" };
        const nextUid = mailbox.uidNext;
        const uids = [...new Set(found)]
          .filter((uid) => uid > lastUid && uid < nextUid)
          .sort((a, b) => a - b);
        const selected = uids.slice(0, BATCH_SIZE);
        const messages: InboxMessage[] = [];
        for (const uid of selected)
          messages.push(await fetchInboxMessage(client, uid, authorized));
        if (!(await authorized()))
          return { kind: "blocked", reason: "MAIL_PROFILE_CHANGED" };
        const hasMore = uids.length > BATCH_SIZE;
        return {
          kind: "batch",
          batch: {
            mailboxKey,
            uidValidity,
            lastUid: hasMore
              ? (selected[selected.length - 1] ?? lastUid)
              : mailbox.uidNext - 1,
            observedAt: new Date().toISOString(),
            hasMore,
            messages,
          },
        };
      } catch (error) {
        if (error instanceof InboxProfileChanged)
          return { kind: "blocked", reason: "MAIL_PROFILE_CHANGED" };
        if (
          error instanceof Error &&
          "authenticationFailed" in error &&
          error.authenticationFailed === true &&
          "serverResponseCode" in error &&
          error.serverResponseCode === "AUTHENTICATIONFAILED"
        ) {
          const paused = await access.pauseProfile?.(
            grant,
            "MAIL_IMAP_CREDENTIALS_REJECTED",
          );
          return {
            kind: "blocked",
            reason:
              paused || (await authorized())
                ? "MAIL_IMAP_CREDENTIALS_REJECTED"
                : "MAIL_PROFILE_CHANGED",
          };
        }
        return {
          kind: "blocked",
          reason: timedOut ? "MAIL_INBOX_TIMEOUT" : "MAIL_INBOX_UNAVAILABLE",
        };
      } finally {
        if (timeout) clearTimeout(timeout);
        mailbox?.release();
        if (client && !timedOut) {
          try {
            await client.logout();
          } catch {
            client.close();
          }
        }
      }
    },
  };
}
