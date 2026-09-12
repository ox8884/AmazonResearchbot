import { MAX_SENT_SOURCE_BYTES } from "./receipt.ts";
import { isIP } from "node:net";
import { checkServerIdentity, type ConnectionOptions } from "node:tls";
import { isAllowedAddress, resolveApprovedTarget } from "@forge-ops/security";
import { createTransport, type SMTPTransportOptions } from "nodemailer";
import type { ImapFlowOptions } from "imapflow";
import { createImapClient } from "./imap.ts";
import type { ApprovedMailProfileGrant, MailConnectorDependencies, MailProfileAccess, SmtpClient, ImapClient } from "./connection-types.ts";
const SMTP_CONNECT_TIMEOUT_MS = 5_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;
export type MailTarget = {
  readonly hostname: string;
  readonly address: string;
  readonly port: number;
};

export type PreparedConnection =
  | { readonly kind: "ready"; readonly target: MailTarget; readonly password: string }
  | { readonly kind: "profile_changed" }
  | { readonly kind: "target_denied" }
  | { readonly kind: "password_unavailable" };

function dnsTargetUrl(hostname: string): string {
  const trimmed = hostname.trim();
  return `https://${isIP(trimmed) === 6 ? `[${trimmed}]` : trimmed}/`;
}

function allowedHost(hostname: string): Readonly<Record<string, true>> {
  const normalized = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  return Object.freeze({ [normalized]: true });
}

function tlsOptions(hostname: string): ConnectionOptions {
  return {
    servername: hostname,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    checkServerIdentity: (_presentedHostname, certificate) =>
      checkServerIdentity(hostname, certificate),
  };
}

async function resolveMailTarget(
  hostname: string,
  port: number,
  dependencies: MailConnectorDependencies,
): Promise<MailTarget | null> {
  const result = await resolveApprovedTarget(
    dnsTargetUrl(hostname),
    allowedHost(hostname),
    dependencies.resolveHost,
  );
  if (!result.ok || !isAllowedAddress(result.target.address)) return null;
  return {
    hostname: result.target.hostname,
    address: result.target.address,
    port,
  };
}

export async function current(
  grant: ApprovedMailProfileGrant,
  access: MailProfileAccess,
): Promise<boolean> {
  try {
    return await access.isCurrent(grant);
  } catch {
    return false;
  }
}

export async function prepareConnection(
  grant: ApprovedMailProfileGrant,
  access: MailProfileAccess,
  dependencies: MailConnectorDependencies,
  endpoint: "smtp" | "imap",
): Promise<PreparedConnection> {
  if (!(await current(grant, access))) return { kind: "profile_changed" };
  const host = endpoint === "smtp" ? grant.config.smtpHost : grant.config.imapHost;
  const port = endpoint === "smtp" ? grant.config.smtpPort : grant.config.imapPort;
  const target = await resolveMailTarget(host, port, dependencies);
  if (!target) return { kind: "target_denied" };
  let password: string;
  try {
    password = await access.readPassword(grant);
  } catch {
    return { kind: "password_unavailable" };
  }
  if (!(await current(grant, access))) return { kind: "profile_changed" };
  return { kind: "ready", target, password };
}

function smtpOptions(
  grant: ApprovedMailProfileGrant,
  target: MailTarget,
  password: string,
): SMTPTransportOptions {
  return {
    host: target.address,
    port: target.port,
    secure: target.port === 465,
    requireTLS: target.port === 587,
    ignoreTLS: false,
    auth: { user: grant.config.username, pass: password },
    tls: tlsOptions(target.hostname),
    pool: false,
    connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
    greetingTimeout: SMTP_CONNECT_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function imapOptions(
  grant: ApprovedMailProfileGrant,
  target: MailTarget,
  password: string,
): ImapFlowOptions {
  return {
    host: target.address,
    port: target.port,
    secure: true,
    servername: target.hostname,
    auth: { user: grant.config.username, pass: password },
    tls: tlsOptions(target.hostname),
    logger: false,
    logRaw: false,
    emitLogs: false,
    maxLineLength: 64 * 1024,
    maxLiteralSize: MAX_SENT_SOURCE_BYTES + 1,
    maxResponseSize: MAX_SENT_SOURCE_BYTES + 64 * 1024,
    disableAutoIdle: true,
    connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
    greetingTimeout: SMTP_CONNECT_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  };
}

export function smtpClient(
  grant: ApprovedMailProfileGrant,
  target: MailTarget,
  password: string,
  dependencies: MailConnectorDependencies,
): SmtpClient {
  const factory = dependencies.createSmtpClient ?? createTransport;
  return factory(smtpOptions(grant, target, password));
}

export function imapClient(
  grant: ApprovedMailProfileGrant,
  target: MailTarget,
  password: string,
  dependencies: MailConnectorDependencies,
): ImapClient {
  const factory = dependencies.createImapClient ?? createImapClient;
  return factory(imapOptions(grant, target, password));
}
