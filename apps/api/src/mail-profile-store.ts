import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  type MailProfileConfig,
  type MailProfileSafeView,
  type MailProfileWrite,
  mailProfileConfigFromWrite,
} from "@forge-ops/domain";
import type { QueryConnection } from "@forge-ops/db";
import { authorizeUrl, encryptSecret, exactPayloadHash, last4 } from "@forge-ops/security";

export type MailProfileRow = {
  readonly id: string;
  readonly name: string;
  readonly smtp_host: string;
  readonly smtp_port: 465 | 587;
  readonly imap_host: string;
  readonly imap_port: 993;
  readonly sender: string;
  readonly username: string;
  readonly sent_mailbox: string;
  readonly inbox_mailbox: string;
  readonly password_ciphertext: string | null;
  readonly password_last4: string | null;
  readonly secret_version: number;
  readonly config_fingerprint: string;
  readonly version: number;
  readonly status: "pending_approval" | "active" | "disabled";
};

type SaveResult =
  | { readonly kind: "saved"; readonly created: boolean; readonly profile: MailProfileSafeView }
  | { readonly kind: "stale" }
  | { readonly kind: "invalid_host" };

type ActivationResult =
  | { readonly kind: "created"; readonly approvalId: string; readonly profile: MailProfileSafeView }
  | { readonly kind: "reused"; readonly approvalId: string; readonly profile: MailProfileSafeView }
  | { readonly kind: "stale" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "secret_required" }
  | { readonly kind: "already_active" };

type DisableResult =
  | { readonly kind: "disabled"; readonly profile: MailProfileSafeView }
  | { readonly kind: "stale" }
  | { readonly kind: "not_configured" };

const profileColumns = `id,name,smtp_host,smtp_port,imap_host,imap_port,sender,username,sent_mailbox,inbox_mailbox,password_ciphertext,password_last4,secret_version,config_fingerprint,version,status`;

function authorizeMailHost(host: string): string | null {
  const candidate = host.toLowerCase().replace(/\.$/, "");
  if (isIP(candidate) !== 0) return null;
  const decision = authorizeUrl(`https://${candidate}`, { [candidate]: true });
  return decision.ok ? decision.hostname : null;
}

function normalizedConfig(config: MailProfileConfig): MailProfileConfig | null {
  const smtpHost = authorizeMailHost(config.smtpHost);
  const imapHost = authorizeMailHost(config.imapHost);
  if (!smtpHost || !imapHost) return null;
  return { ...config, smtpHost, imapHost };
}

export function mailProfileConfigFromRow(row: MailProfileRow): MailProfileConfig {
  return {
    name: row.name,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    sender: row.sender,
    username: row.username,
    sentMailbox: row.sent_mailbox,
    inboxMailbox: row.inbox_mailbox,
  };
}

export function mailProfileView(row: MailProfileRow | undefined): MailProfileSafeView {
  if (!row) {
    return {
      profileId: null,
      version: null,
      status: "unconfigured",
      configuredFields: null,
      secretConfigured: false,
      last4: null,
      connectionStatus: "unconfigured",
    };
  }
  return {
    profileId: row.id,
    version: row.version,
    status: row.status,
    configuredFields: mailProfileConfigFromRow(row),
    secretConfigured: row.password_ciphertext !== null,
    last4: row.password_last4,
    connectionStatus: "unverified",
  };
}

export async function readMailProfile(
  db: Pick<QueryConnection, "query">,
  lock = false,
): Promise<MailProfileRow | undefined> {
  if (lock) await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.mail_profile'))");
  const query = `SELECT ${profileColumns} FROM mail_profiles WHERE singleton_key=1${lock ? " FOR UPDATE" : ""}`;
  const result = await db.query<MailProfileRow>(query);
  return result.rows[0];
}

export function mailProfileFingerprint(
  profileId: string,
  config: MailProfileConfig,
  secretVersion: number,
): string {
  return exactPayloadHash({ profileId, config, secretVersion });
}

export async function recordMailProfileHistory(
  db: Pick<QueryConnection, "query">,
  row: MailProfileRow,
  event: "saved" | "activation_requested" | "activated" | "disabled",
  actor: string,
  approvalId: string | null = null,
): Promise<void> {
  await db.query(
    `INSERT INTO mail_profile_history(profile_id,version,event,safe_snapshot,config_fingerprint,secret_version,approval_id,actor)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
    [
      row.id,
      row.version,
      event,
      JSON.stringify(mailProfileConfigFromRow(row)),
      row.config_fingerprint,
      row.secret_version,
      approvalId,
      actor,
    ],
  );
}

async function recordAudit(
  db: Pick<QueryConnection, "query">,
  actor: string,
  action: "mail_profile_saved" | "mail_profile_activation_requested" | "mail_profile_activated" | "mail_profile_disabled",
  row: MailProfileRow,
  secretUpdated: boolean,
): Promise<void> {
  await db.query(
    "INSERT INTO audit_events(actor,action,target,meta) VALUES($1,$2,$3,$4::jsonb)",
    [
      actor,
      action,
      row.id,
      JSON.stringify({ version: row.version, secretUpdated, configFingerprint: row.config_fingerprint }),
    ],
  );
}

export async function saveMailProfile(
  db: QueryConnection,
  input: MailProfileWrite,
  key: Buffer,
  actor: string,
): Promise<SaveResult> {
  const config = normalizedConfig(mailProfileConfigFromWrite(input));
  if (!config) return { kind: "invalid_host" };
  const existing = await readMailProfile(db, true);
  if (existing && input.expectedVersion !== existing.version)
    return { kind: "stale" };
  if (!existing && input.expectedVersion !== undefined) return { kind: "stale" };
  const password = input.password;
  const configChanged = existing
    ? exactPayloadHash(config) !== exactPayloadHash(mailProfileConfigFromRow(existing))
    : true;
  const secretChanged = password !== undefined;
  if (existing && !configChanged && !secretChanged)
    return { kind: "saved", created: false, profile: mailProfileView(existing) };

  const id = existing?.id ?? randomUUID();
  const version = (existing?.version ?? 0) + 1;
  const secretVersion = secretChanged ? (existing?.secret_version ?? 0) + 1 : (existing?.secret_version ?? 0);
  const ciphertext = secretChanged
    ? encryptSecret(Buffer.from(password, "utf8"), key, `mail_profile:${id}:${secretVersion}:password`)
    : (existing?.password_ciphertext ?? null);
  const passwordLast4 = secretChanged ? last4(password) : (existing?.password_last4 ?? null);
  const fingerprint = mailProfileFingerprint(id, config, secretVersion);
  const result = await db.query<MailProfileRow>(
    existing
      ? `UPDATE mail_profiles SET name=$2,smtp_host=$3,smtp_port=$4,imap_host=$5,imap_port=$6,sender=$7,username=$8,sent_mailbox=$9,inbox_mailbox=$10,password_ciphertext=$11,password_last4=$12,secret_version=$13,config_fingerprint=$14,version=$15,status='pending_approval',updated_at=now(),activated_at=NULL,disabled_at=NULL WHERE id=$1 RETURNING ${profileColumns}`
      : `INSERT INTO mail_profiles(id,name,smtp_host,smtp_port,imap_host,imap_port,sender,username,sent_mailbox,inbox_mailbox,password_ciphertext,password_last4,secret_version,config_fingerprint,version,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending_approval') RETURNING ${profileColumns}`,
    [id, config.name, config.smtpHost, config.smtpPort, config.imapHost, config.imapPort, config.sender, config.username, config.sentMailbox, config.inboxMailbox, ciphertext, passwordLast4, secretVersion, fingerprint, version],
  );
  const saved = result.rows[0];
  if (!saved) throw new Error("Mail profile was not saved");
  await db.query("UPDATE approvals SET status='stale' WHERE kind='provider_activation' AND status='pending' AND payload->>'target'='mail_profile' AND payload->>'profileId'=$1", [saved.id]);
  await recordMailProfileHistory(db, saved, "saved", actor);
  await recordAudit(db, actor, "mail_profile_saved", saved, secretChanged);
  return { kind: "saved", created: !existing, profile: mailProfileView(saved) };
}

export async function createMailProfileActivationProposal(
  db: QueryConnection,
  actor: string,
  expectedVersion: number | undefined,
): Promise<ActivationResult> {
  const profile = await readMailProfile(db, true);
  if (!profile) return { kind: "not_configured" };
  if (expectedVersion !== undefined && expectedVersion !== profile.version) return { kind: "stale" };
  if (!profile.password_ciphertext || profile.secret_version === 0) return { kind: "secret_required" };
  if (profile.status === "active") return { kind: "already_active" };
  const pending = await db.query<{ readonly id: string }>(
    "SELECT id FROM approvals WHERE kind='provider_activation' AND status='pending' AND payload->>'target'='mail_profile' AND payload->>'profileId'=$1 AND (payload->>'version')::integer=$2 AND payload->>'configFingerprint'=$3 FOR UPDATE",
    [profile.id, profile.version, profile.config_fingerprint],
  );
  if (pending.rows[0]) return { kind: "reused", approvalId: pending.rows[0].id, profile: mailProfileView(profile) };
  const payload = {
    payloadVersion: 1,
    target: "mail_profile",
    profileId: profile.id,
    version: profile.version,
    config: mailProfileConfigFromRow(profile),
    secretVersion: profile.secret_version,
    configFingerprint: profile.config_fingerprint,
    connectionStatus: "unverified",
  };
  const inserted = await db.query<{ readonly id: string }>(
    "INSERT INTO approvals(kind,payload_hash,payload,status) VALUES('provider_activation',$1,$2::jsonb,'pending') RETURNING id",
    [exactPayloadHash(payload), JSON.stringify(payload)],
  );
  const approvalId = inserted.rows[0]?.id;
  if (!approvalId) throw new Error("Mail profile activation proposal was not saved");
  const activated = await db.query<MailProfileRow>(
    `UPDATE mail_profiles SET status='pending_approval',updated_at=now() WHERE id=$1 RETURNING ${profileColumns}`,
    [profile.id],
  );
  const current = activated.rows[0];
  if (!current) throw new Error("Mail profile disappeared during activation proposal");
  await recordMailProfileHistory(db, current, "activation_requested", actor, approvalId);
  await recordAudit(db, actor, "mail_profile_activation_requested", current, false);
  return { kind: "created", approvalId, profile: mailProfileView(current) };
}

export async function disableMailProfile(
  db: QueryConnection,
  actor: string,
  expectedVersion: number | undefined,
): Promise<DisableResult> {
  const profile = await readMailProfile(db, true);
  if (!profile) return { kind: "not_configured" };
  if (profile.status === "disabled") return { kind: "disabled", profile: mailProfileView(profile) };
  if (expectedVersion !== undefined && expectedVersion !== profile.version) return { kind: "stale" };
  const result = await db.query<MailProfileRow>(
    `UPDATE mail_profiles SET status='disabled',version=version+1,disabled_at=now(),updated_at=now() WHERE id=$1 RETURNING ${profileColumns}`,
    [profile.id],
  );
  const disabled = result.rows[0];
  if (!disabled) throw new Error("Mail profile was not disabled");
  await db.query("UPDATE approvals SET status='stale' WHERE kind='provider_activation' AND status='pending' AND payload->>'target'='mail_profile' AND payload->>'profileId'=$1", [disabled.id]);
  await recordMailProfileHistory(db, disabled, "disabled", actor);
  await recordAudit(db, actor, "mail_profile_disabled", disabled, false);
  return { kind: "disabled", profile: mailProfileView(disabled) };
}
