import { createHash } from "node:crypto";
import type { Pool } from "@forge-ops/db";
import type { MailTransport } from "@forge-ops/integrations/mail/transport";
import {
  createComposioGmailTransport,
  type ComposioMcpWire,
} from "@forge-ops/integrations/mail/composio";
import { resolveWorkMailTransport } from "./work-mail.ts";

type ActiveComposioConnection = {
  readonly user_id: string;
  readonly account_id: string;
  readonly email: string;
};

export async function resolveSummaryMailTransport(
  pool: Pool,
  encryptionKey: Buffer,
  appEnv: string,
  mailMode: string | undefined,
  summaryMode: string | undefined,
  composioApiKey: string | undefined,
  wire?: ComposioMcpWire,
): Promise<MailTransport | null> {
  if (summaryMode === "disabled") return null;
  if (summaryMode === "composio") {
    const apiKey = composioApiKey?.trim();
    if (!apiKey) return null;
    const fingerprint = createHash("sha256")
      .update(`mcp-v1:${apiKey}`)
      .digest("hex");
    const connections = await pool.query<ActiveComposioConnection>(
      `SELECT c.user_id,c.account_id,c.email
       FROM composio_gmail_connections c
       WHERE c.status='active' AND c.key_fingerprint=$1
         AND c.account_id IS NOT NULL AND c.email IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM settings_versions v
           WHERE v.version=(SELECT max(version) FROM settings_versions)
             AND v.snapshot->'summaryEmailEnabled'='true'::jsonb
             AND lower(v.snapshot->>'summaryEmail')=lower(c.email)
         )
       LIMIT 2`,
      [fingerprint],
    );
    if (connections.rows.length !== 1) return null;
    const connection = connections.rows[0];
    if (!connection) return null;
    const access = {
      accountId: connection.account_id,
      recipient: connection.email,
      isCurrent: async () => {
        const current = await pool.query<{ readonly active: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM composio_gmail_connections c
             WHERE c.user_id=$1 AND c.account_id=$2 AND c.key_fingerprint=$3
               AND c.status='active' AND lower(c.email)=lower($4)
               AND EXISTS (
                 SELECT 1 FROM settings_versions v
                 WHERE v.version=(SELECT max(version) FROM settings_versions)
                   AND v.snapshot->'summaryEmailEnabled'='true'::jsonb
                   AND lower(v.snapshot->>'summaryEmail')=lower($4)
               )
           ) AS active`,
          [connection.user_id, connection.account_id, fingerprint, connection.email],
        );
        return current.rows[0]?.active === true;
      },
    };
    return createComposioGmailTransport(apiKey, access, wire);
  }
  if (summaryMode !== undefined) return null;
  return resolveWorkMailTransport(pool, encryptionKey, appEnv, mailMode);
}
