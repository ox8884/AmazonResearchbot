import { createHmac, timingSafeEqual } from "node:crypto";
import { symmetricDecrypt } from "better-auth/crypto";
import type { Pool } from "@forge-ops/db";

const CURRENT_PREFIX = "frc1";
const HASH_PREFIX = "rhc1";
const HASH_PATTERN = /^rhc1\.[A-Za-z0-9_-]{43}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CODES = 100;
const MAX_CODE_LENGTH = 256;
const MAX_STORED_LENGTH = 16_384;
const CODE_DOMAIN = "forge-kitchen/recovery-code/hash/v1";
const STORAGE_DOMAIN = "forge-kitchen/recovery-code/storage/v1";

export class RecoveryCodeStorageError extends Error {
  readonly code = "RECOVERY_CODE_STORAGE_INVALID";

  constructor() {
    super("RECOVERY_CODE_STORAGE_INVALID");
    this.name = "RecoveryCodeStorageError";
  }
}

export type RecoveryCodeStorage = {
  readonly encrypt: (json: string) => Promise<string>;
  readonly decrypt: (stored: string) => Promise<string>;
  readonly hashInput: (rawCode: string) => string;
};

function invalidStorage(): RecoveryCodeStorageError {
  return new RecoveryCodeStorageError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codeListFromJson(json: string): readonly string[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw invalidStorage();
  }
  if (!Array.isArray(value) || value.length > MAX_CODES) throw invalidStorage();
  const codes: string[] = [];
  for (const code of value) {
    if (
      typeof code !== "string" ||
      code.length === 0 ||
      code.length > MAX_CODE_LENGTH
    ) {
      throw invalidStorage();
    }
    codes.push(code);
  }
  return codes;
}

function distinct(codes: readonly string[]): boolean {
  return new Set(codes).size === codes.length;
}

function hmac(secret: string, domain: string, value: string): string {
  return createHmac("sha256", secret)
    .update(domain)
    .update("\u0000")
    .update(value)
    .digest("base64url");
}

function hashCode(secret: string, rawCode: string): string {
  return `${HASH_PREFIX}.${hmac(secret, CODE_DOMAIN, rawCode)}`;
}

function equalMac(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false;
  return timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(received, "utf8"),
  );
}

function currentEnvelope(secret: string, codes: readonly string[]): string {
  if (!distinct(codes) || !codes.every((code) => HASH_PATTERN.test(code)))
    throw invalidStorage();
  const payload = JSON.stringify({ v: 1, codes });
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  const tag = hmac(secret, STORAGE_DOMAIN, encodedPayload);
  return `${CURRENT_PREFIX}.${encodedPayload}.${tag}`;
}

function decodeCurrentEnvelope(
  secret: string,
  stored: string,
): readonly string[] | null {
  if (!stored.startsWith(`${CURRENT_PREFIX}.`)) return null;
  if (stored.length > MAX_STORED_LENGTH) throw invalidStorage();
  const parts = stored.split(".");
  const version = parts[0];
  const encodedPayload = parts[1];
  const tag = parts[2];
  if (
    parts.length !== 3 ||
    version !== CURRENT_PREFIX ||
    encodedPayload === undefined ||
    tag === undefined ||
    !BASE64URL_PATTERN.test(encodedPayload) ||
    !BASE64URL_PATTERN.test(tag) ||
    !equalMac(hmac(secret, STORAGE_DOMAIN, encodedPayload), tag)
  ) {
    throw invalidStorage();
  }
  let payloadText: string;
  let payload: unknown;
  try {
    payloadText = Buffer.from(encodedPayload, "base64url").toString("utf8");
    if (
      Buffer.from(payloadText, "utf8").toString("base64url") !== encodedPayload
    )
      throw invalidStorage();
    payload = JSON.parse(payloadText);
  } catch (error) {
    if (error instanceof RecoveryCodeStorageError) throw error;
    throw invalidStorage();
  }
  if (
    !isRecord(payload) ||
    payload["v"] !== 1 ||
    !Array.isArray(payload["codes"])
  )
    throw invalidStorage();
  const codes = codeListFromJson(JSON.stringify(payload["codes"]));
  if (!distinct(codes) || !codes.every((code) => HASH_PATTERN.test(code)))
    throw invalidStorage();
  if (payloadText !== JSON.stringify({ v: 1, codes })) throw invalidStorage();
  return codes;
}

function legacyCodesToHashes(secret: string, json: string): string {
  return JSON.stringify(
    codeListFromJson(json).map((code) => hashCode(secret, code)),
  );
}

export function createRecoveryCodeStorage(
  authSecret: string,
): RecoveryCodeStorage {
  if (authSecret.length < 32) throw invalidStorage();
  const hashInput = (rawCode: string): string => hashCode(authSecret, rawCode);
  return {
    hashInput,
    async encrypt(json: string): Promise<string> {
      const codes = codeListFromJson(json);
      const allAlreadyHashed = codes.every((code) => HASH_PATTERN.test(code));
      if (!allAlreadyHashed && codes.some((code) => HASH_PATTERN.test(code)))
        throw invalidStorage();
      return currentEnvelope(
        authSecret,
        allAlreadyHashed ? codes : codes.map(hashInput),
      );
    },
    async decrypt(stored: string): Promise<string> {
      const current = decodeCurrentEnvelope(authSecret, stored);
      if (current !== null) return JSON.stringify(current);
      let legacyJson: string;
      try {
        legacyJson = await symmetricDecrypt({ key: authSecret, data: stored });
      } catch {
        throw invalidStorage();
      }
      return legacyCodesToHashes(authSecret, legacyJson);
    },
  };
}

export async function migrateLegacyRecoveryCodeStorage(
  pool: Pick<Pool, "query">,
  storage: RecoveryCodeStorage,
  input: { readonly twoFactorId: string },
): Promise<{ readonly changedCount: number }> {
  const rows = await pool.query<{ id: string; backup_codes: string | null }>(
    "SELECT id,backup_codes FROM two_factor WHERE id=$1 AND backup_codes IS NOT NULL",
    [input.twoFactorId],
  );
  let changedCount = 0;
  for (const row of rows.rows) {
    if (row.backup_codes === null) continue;
    const current = row.backup_codes.startsWith(`${CURRENT_PREFIX}.`);
    const hashesJson = await storage.decrypt(row.backup_codes);
    if (current) continue;
    const replacement = await storage.encrypt(hashesJson);
    const updated = await pool.query(
      "UPDATE two_factor SET backup_codes=$3 WHERE id=$1 AND backup_codes=$2",
      [row.id, row.backup_codes, replacement],
    );
    changedCount += updated.rowCount ?? 0;
  }
  return { changedCount };
}

export async function prepareRecoveryCodeStorage(
  pool: Pool,
  authSecret: string,
): Promise<{ changedCount: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const storage = createRecoveryCodeStorage(authSecret);
    const rows = await client.query<{ id: string }>(
      "SELECT id FROM two_factor WHERE backup_codes IS NOT NULL ORDER BY id FOR UPDATE",
    );
    let changedCount = 0;
    for (const row of rows.rows)
      changedCount += (
        await migrateLegacyRecoveryCodeStorage(client, storage, {
          twoFactorId: row.id,
        })
      ).changedCount;
    await client.query("COMMIT");
    return { changedCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
