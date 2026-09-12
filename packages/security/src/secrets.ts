import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "fops1";

export function parseKey(hex: string): Buffer {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes as 64 hex chars");
  }
  return Buffer.from(trimmed, "hex");
}

export function encryptSecret(
  plaintext: Buffer,
  key: Buffer,
  aad: string,
  keyVersion = 1,
): string {
  if (keyVersion !== 1) throw new Error("Unsupported encryption key version");
  if (key.length !== 32) throw new Error("Invalid encryption key");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    String(keyVersion),
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, key: Buffer, aad: string): Buffer {
  const parts = payload.split(".");
  if (parts.length !== 5 || parts[0] !== PREFIX || parts[1] !== "1" || key.length !== 32 || parts.slice(2).some(part => !/^[A-Za-z0-9_-]*$/.test(part))) {
    throw new Error("ciphertext rejected");
  }
  const nonce = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
  const tag = Buffer.from(parts[4] ?? "", "base64url");
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("ciphertext rejected");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("ciphertext rejected");
  }
}

export function last4(value: string): string {
  if (value.length <= 4) return "••••";
  return value.slice(-4);
}
