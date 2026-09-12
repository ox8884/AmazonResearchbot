export type ApiEnv = {
  aiTransport?: "disabled" | "official";
  composioApiKey?: string;
  composioOwnerEmail?: string;
  appEnv: "development" | "production";
  databaseUrl: string;
  webOrigin: string;
  apiPort: number;
  authSecret: string;
  encryptionKeyHex: string;
  jsDailyWireCap: number;
  mailTransport: "disabled" | "mailpit" | "profile";
};

export function loadEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const appEnv = source.APP_ENV === "production" ? "production" : "development";
  const databaseUrl = source.DATABASE_URL;
  const webOrigin = source.WEB_ORIGIN ?? "http://localhost:5173";
  const authSecret = source.BETTER_AUTH_SECRET;
  const encryptionKeyHex = source.ENCRYPTION_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  if (!authSecret || authSecret.length < 32) throw new Error("BETTER_AUTH_SECRET must be 32+ chars");
  if (!encryptionKeyHex) throw new Error("ENCRYPTION_KEY missing");
  return {
    aiTransport: source.AI_TRANSPORT === "official" ? "official" : "disabled",
    ...(source.COMPOSIO_API_KEY?.trim() ? {composioApiKey:source.COMPOSIO_API_KEY.trim()} : {}),
    composioOwnerEmail: source.BOOTSTRAP_EMAIL ?? "jay@local.test",
    appEnv,
    databaseUrl,
    webOrigin,
    apiPort: Number(source.API_PORT ?? 3001),
    authSecret,
    encryptionKeyHex,
    jsDailyWireCap: Number(source.JS_DAILY_WIRE_CAP ?? 0),
    mailTransport: source.MAIL_TRANSPORT === "mailpit" ? (appEnv === "development" ? "mailpit" : "disabled")
      : source.MAIL_TRANSPORT === "profile" || source.MAIL_TRANSPORT === "smtp" ? "profile" : "disabled",
  };
}
