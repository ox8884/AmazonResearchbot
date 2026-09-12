import { z } from "zod";

const mailHostSchema = z.string().trim().min(1).max(253);
const mailboxSchema = z.string().trim().min(1).max(255);

export const mailProfileConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    smtpHost: mailHostSchema,
    smtpPort: z.union([z.literal(465), z.literal(587)]),
    imapHost: mailHostSchema,
    imapPort: z.literal(993),
    sender: z.email().max(320),
    username: z.string().trim().min(1).max(320),
    sentMailbox: mailboxSchema,
    inboxMailbox: mailboxSchema,
  })
  .strict();

export const mailProfileWriteSchema = mailProfileConfigSchema
  .extend({
    expectedVersion: z.number().int().positive().optional(),
    password: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const mailProfileActivationSchema = z
  .object({
    payloadVersion: z.literal(1),
    target: z.literal("mail_profile"),
    profileId: z.uuid(),
    version: z.number().int().positive(),
    config: mailProfileConfigSchema,
    secretVersion: z.number().int().positive(),
    configFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    connectionStatus: z.literal("unverified"),
  })
  .strict();

export type MailProfileConfig = z.infer<typeof mailProfileConfigSchema>;
export type MailProfileWrite = z.infer<typeof mailProfileWriteSchema>;
export type MailProfileActivation = z.infer<typeof mailProfileActivationSchema>;

export type MailProfileSafeView = {
  readonly profileId: string | null;
  readonly version: number | null;
  readonly status: "unconfigured" | "pending_approval" | "active" | "disabled";
  readonly configuredFields: MailProfileConfig | null;
  readonly secretConfigured: boolean;
  readonly last4: string | null;
  readonly connectionStatus: "unconfigured" | "unverified";
};

export function mailProfileConfigFromWrite(input: MailProfileWrite): MailProfileConfig {
  return {
    name: input.name,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    sender: input.sender,
    username: input.username,
    sentMailbox: input.sentMailbox,
    inboxMailbox: input.inboxMailbox,
  };
}
