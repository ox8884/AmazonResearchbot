import { resolveApprovedWorkMail } from "./mail-profile-access.ts";
import type { Pool } from "@forge-ops/db";
import type { MailConnectorDependencies } from "@forge-ops/integrations/mail/connection-types";
import type { ContactTransport } from "@forge-ops/integrations/mail/transport";
export async function resolveWorkMailTransport(
  pool: Pool,
  key: Buffer,
  appEnv: string,
  mode: string | undefined,
  dependencies: MailConnectorDependencies = {},
): Promise<ContactTransport | null> {
  if (mode === "disabled") return null;
  if (mode === "mailpit") {
    if (appEnv !== "development") return null;
    const { createMailpitTransport } =
      await import("@forge-ops/integrations/mail/mailpit");
    return createMailpitTransport(appEnv);
  }
  if (mode !== "profile" && mode !== "smtp") return null;
  const approved = await resolveApprovedWorkMail(pool, key);
  if (!approved) return null;
  const { grant, access } = approved;
  const { createSmtpImapTransport } =
    await import("@forge-ops/integrations/mail/smtp");
  return createSmtpImapTransport(grant, access, dependencies);
}
