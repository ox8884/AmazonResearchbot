import { current } from "./connection.ts";
import type {
  ApprovedMailProfileGrant,
  MailProfileAccess,
} from "./connection-types.ts";

export async function rejectedBeforeData(
  error: unknown,
  grant: ApprovedMailProfileGrant,
  access: MailProfileAccess,
): Promise<string | null> {
  if (
    !(error instanceof Error) ||
    !("responseCode" in error) ||
    typeof error.responseCode !== "number" ||
    error.responseCode < 500 ||
    error.responseCode >= 600 ||
    !("code" in error) ||
    !("command" in error) ||
    typeof error.command !== "string"
  )
    return null;
  const reason =
    error.code === "EAUTH" && /^AUTH(?: |$)/.test(error.command)
      ? "MAIL_SMTP_CREDENTIALS_REJECTED"
      : error.code === "EENVELOPE" && error.command === "MAIL FROM"
        ? "MAIL_SMTP_SENDER_REJECTED"
        : error.code === "EENVELOPE" && error.command === "RCPT TO"
          ? "MAIL_SMTP_RECIPIENT_REJECTED"
          : null;
  if (!reason) return null;
  if (reason !== "MAIL_SMTP_RECIPIENT_REJECTED" && access.pauseProfile) {
    if (await access.pauseProfile(grant, reason)) return reason;
  }
  return (await current(grant, access)) ? reason : "MAIL_PROFILE_CHANGED";
}
