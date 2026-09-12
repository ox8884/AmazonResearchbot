const SECRET_KEY = /authorization|cookie|set-cookie|token|apikey|api_key|password|secret|totp|pairingCode|credential/i;

export function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string" && value.startsWith("fops1.")) return "[ciphertext]";
  return value;
}

export const PINO_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "req.headers['cf-access-client-id']",
  "req.headers['cf-access-client-secret']",
  "req.headers['cf-access-jwt-assertion']",
  "req.body.pairingCode",
  "*.pairingCode",
  "*.credential",
  "*.password",
  "*.apiKey",
  "*.token",
  "*.secret",
];
