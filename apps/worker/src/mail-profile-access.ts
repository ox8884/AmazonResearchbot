import type { Pool } from "@forge-ops/db";
import { mailProfileConfigSchema } from "@forge-ops/domain";
import { decryptSecret, exactPayloadHash } from "@forge-ops/security";
import type {
  ApprovedMailProfileGrant,
  MailProfileAccess,
} from "@forge-ops/integrations/mail/connection-types";
export type ApprovedWorkMail = {
  readonly grant: ApprovedMailProfileGrant;
  readonly access: MailProfileAccess;
  readonly activatedAt: Date | null;
};
export async function resolveApprovedWorkMail(
  pool: Pool,
  key: Buffer,
): Promise<ApprovedWorkMail | null> {
  const result = await pool.query<{
    id: string;
    version: number;
    secret_version: number;
    config_fingerprint: string;
    activated_at: Date | null;
    config: unknown;
  }>(`SELECT id,version,secret_version,config_fingerprint,activated_at,
    jsonb_build_object('name',name,'smtpHost',smtp_host,'smtpPort',smtp_port,'imapHost',imap_host,'imapPort',imap_port,'sender',sender,'username',username,'sentMailbox',sent_mailbox,'inboxMailbox',inbox_mailbox) AS config
    FROM mail_profiles WHERE singleton_key=1 AND status='active' AND password_ciphertext IS NOT NULL`);
  const row = result.rows[0];
  if (!row) return null;
  const config = mailProfileConfigSchema.safeParse(row.config);
  if (!config.success) return null;
  const fingerprint = exactPayloadHash({
    profileId: row.id,
    config: config.data,
    secretVersion: row.secret_version,
  });
  if (fingerprint !== row.config_fingerprint) return null;
  const grant: ApprovedMailProfileGrant = Object.freeze({
    id: row.id,
    version: row.version,
    secretVersion: row.secret_version,
    config: Object.freeze(config.data),
  });
  const parameters = [
    grant.id,
    grant.version,
    grant.secretVersion,
    fingerprint,
  ];
  const currentWhere =
    "id=$1 AND version=$2 AND secret_version=$3 AND config_fingerprint=$4 AND status='active'";
  const access: MailProfileAccess = {
    isCurrent: async () => {
      const current = await pool.query<{ active: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM mail_profiles WHERE ${currentWhere}) AS active`,
        parameters,
      );
      return current.rows[0]?.active === true;
    },
    pauseProfile: async (_grant, reason) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('forge.mail_profile'))",
        );
        const paused = await client.query<{ version: number }>(
          `UPDATE mail_profiles SET status='disabled',version=version+1,disabled_at=now(),updated_at=now() WHERE ${currentWhere} RETURNING version`,
          parameters,
        );
        const version = paused.rows[0]?.version;
        if (version === undefined) {
          await client.query("COMMIT");
          return false;
        }
        await client.query(
          "UPDATE approvals SET status='stale' WHERE kind='provider_activation' AND status='pending' AND payload->>'target'='mail_profile' AND payload->>'profileId'=$1",
          [grant.id],
        );
        await client.query(
          `INSERT INTO mail_profile_history(profile_id,version,event,safe_snapshot,config_fingerprint,secret_version,actor)
          VALUES($1,$2,'disabled',$3::jsonb,$4,$5,'worker')`,
          [
            grant.id,
            version,
            JSON.stringify(grant.config),
            fingerprint,
            grant.secretVersion,
          ],
        );
        await client.query(
          "INSERT INTO audit_events(actor,action,target,meta) VALUES('worker','mail_profile_connection_rejected',$1,$2::jsonb)",
          [
            grant.id,
            JSON.stringify({ reason, version, previousVersion: grant.version }),
          ],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    readPassword: async () => {
      const secret = await pool.query<{ password_ciphertext: string | null }>(
        `SELECT password_ciphertext FROM mail_profiles WHERE ${currentWhere}`,
        parameters,
      );
      const encrypted = secret.rows[0]?.password_ciphertext;
      if (!encrypted) throw new Error("MAIL_PROFILE_CHANGED");
      return decryptSecret(
        encrypted,
        key,
        `mail_profile:${grant.id}:${grant.secretVersion}:password`,
      ).toString("utf8");
    },
  };
  return { grant, access, activatedAt: row.activated_at };
}
