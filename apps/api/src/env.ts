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
  jsDailyBrowserCap?: number;
  mailTransport: "disabled" | "mailpit" | "profile";
};

// Dashboard-only daily cap for Jungle Scout browser reads; unset keeps sharing the API wire cap.
export function browserCap(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const cap = Number(value);
  if (!Number.isSafeInteger(cap) || cap < 0) throw new Error("JS_DAILY_BROWSER_CAP must be a non-negative integer");
  return cap;
}

export function loadEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const appEnv = source.APP_ENV === "production" ? "production" : "development";
  const databaseUrl = source.DATABASE_URL;
  const webOrigin = source.WEB_ORIGIN ?? "http://localhost:5173";
  const authSecret = source.BETTER_AUTH_SECRET;
  const encryptionKeyHex = source.ENCRYPTION_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  if (!authSecret || authSecret.length < 32) throw new Error("BETTER_AUTH_SECRET must be 32+ chars");
  if (!encryptionKeyHex) throw new Error("ENCRYPTION_KEY missing");
  const jsDailyBrowserCap = browserCap(source.JS_DAILY_BROWSER_CAP);
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
    ...(jsDailyBrowserCap !== undefined ? { jsDailyBrowserCap } : {}),
    mailTransport: source.MAIL_TRANSPORT === "mailpit" ? (appEnv === "development" ? "mailpit" : "disabled")
      : source.MAIL_TRANSPORT === "profile" || source.MAIL_TRANSPORT === "smtp" ? "profile" : "disabled",
  };
}
