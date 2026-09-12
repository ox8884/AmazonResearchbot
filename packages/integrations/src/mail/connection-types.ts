import type { MailProfileConfig } from "@forge-ops/domain";
import type { HostResolver } from "@forge-ops/security";
import type { ImapFlowOptions } from "imapflow";
import type {
  SMTPTransportOptions,
  SMTPSentMessageInfo,
  Transporter,
} from "nodemailer";

export type ApprovedMailProfileGrant = {
  readonly id: string;
  readonly version: number;
  readonly secretVersion: number;
  readonly config: MailProfileConfig;
};

export type MailProfilePauseReason =
  "MAIL_SMTP_CREDENTIALS_REJECTED" | "MAIL_SMTP_SENDER_REJECTED" | "MAIL_IMAP_CREDENTIALS_REJECTED";

export type MailProfileAccess = {
  readonly isCurrent: (grant: ApprovedMailProfileGrant) => Promise<boolean>;
  readonly readPassword: (grant: ApprovedMailProfileGrant) => Promise<string>;
  readonly pauseProfile?: (
    grant: ApprovedMailProfileGrant,
    reason: MailProfilePauseReason,
  ) => Promise<boolean>;
};

export type SmtpClient = Pick<
  Transporter<SMTPSentMessageInfo>,
  "close" | "sendMail" | "verify"
>;

export type SmtpClientFactory = (options: SMTPTransportOptions) => SmtpClient;

export type ImapMailboxLock = {
  readonly release: () => void;
};

export type ImapSentMessage = {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly subject: string | null;
  readonly source: Buffer | null;
};

export type ImapClient = {
  readonly connect: () => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly getMailboxLock: (
    mailbox: string,
    options: { readonly readOnly: true },
  ) => Promise<ImapMailboxLock>;
  readonly searchExactMessageId: (
    messageId: string,
  ) => Promise<readonly number[]>;
  readonly fetchSentMessage: (uid: number) => Promise<ImapSentMessage | null>;
};

export type ImapClientFactory = (options: ImapFlowOptions) => ImapClient;

export type MailConnectorDependencies = {
  readonly resolveHost?: HostResolver;
  readonly createSmtpClient?: SmtpClientFactory;
  readonly createImapClient?: ImapClientFactory;
};
