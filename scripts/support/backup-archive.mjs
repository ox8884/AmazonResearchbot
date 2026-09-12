import {browserSigningRecovery,verifyBrowserSigningRecovery} from "./browser-signing-recovery.mjs";
import { relative, isAbsolute, sep } from "node:path";
import { createRecoveryCodeStorage } from "../../apps/api/src/recovery-code-storage.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  decryptSecret,
  parseKey,
} from "../../packages/security/src/secrets.ts";

export const LIMIT = 64 * 1024 * 1024;
export const FORMAT = "forge-local-backup-v1";
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function localUrl(value) {
  const url = new URL(value);
  assert.ok(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname === "127.0.0.1" &&
      url.port === "5433" &&
      url.username === "forge" &&
      !url.search &&
      !url.hash,
    "Only the configured local Docker database is supported",
  );
  assert.match(
    url.pathname,
    /^\/forge_ops(?:_acceptance_[a-f0-9]{12})?$/,
    "Source must be main or an isolated acceptance database",
  );
  return url;
}
export function docker(args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.platform === "win32" ? "docker.exe" : "docker",
      ["compose", "-p", "forgeops", "exec", "-T", "postgres", ...args],
      { stdio: ["pipe", "pipe", "pipe"], shell: false },
    );
    const chunks = [];
    let length = 0,
      failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      child.kill();
      reject(new Error("Local database archive command failed"));
    };
    const timer = setTimeout(fail, 120000);
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      length += chunk.length;
      if (length > LIMIT) fail();
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!failed) {
        if (code !== 0)
          reject(new Error("Local database archive command failed"));
        else resolvePromise(Buffer.concat(chunks));
      }
    });
    child.stdin.end(input);
  });
}
export async function fingerprints(db) {
  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const result = [];
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const row = (
      await db.query(
        `SELECT count(*)::int AS count, encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS hash FROM public.${quoted} t`,
      )
    ).rows[0];
    result.push({ table: tablename, count: row.count, sha256: row.hash });
  }
  return result;
}
export function recoveryMaterial(value) {
  assert.ok(
    value &&
      typeof value.authSecret === "string" &&
      value.authSecret.length >= 32,
    "Recovery authentication secret is required",
  );
  parseKey(value.encryptionKeyHex);
  const signing=browserSigningRecovery(value.browserSigningKeyPem);
  return {
    authSecret: value.authSecret,
    encryptionKeyHex: value.encryptionKeyHex,
    ...(signing?{browserSigningKeyPem:signing.pem}:{}),
  };
}
export async function readEncrypted(file, key, aad) {
  assert.ok(
    (await stat(file)).size < LIMIT * 3,
    "Local archive exceeds supported size",
  );
  return JSON.parse(
    decryptSecret(await readFile(file, "utf8"), key, aad).toString("utf8"),
  );
}

export async function verifyRecoveryMaterial(db, recovery) {
  const signingFingerprint=await verifyBrowserSigningRecovery(db,recovery.browserSigningKeyPem);
  const key = parseKey(recovery.encryptionKeyHex);
  const imports = (
    await db.query("SELECT filename,sha256,blob_ciphertext FROM imports")
  ).rows;
  for (const source of imports) {
    const raw = decryptSecret(
      source.blob_ciphertext,
      key,
      `import:${source.filename}:bytes`,
    );
    assert.equal(
      digest(raw),
      source.sha256,
      "Encrypted source integrity check failed",
    );
  }
  const storage = createRecoveryCodeStorage(recovery.authSecret);
  const factors = (
    await db.query(
      "SELECT backup_codes FROM two_factor WHERE backup_codes IS NOT NULL",
    )
  ).rows;
  for (const factor of factors) await storage.decrypt(factor.backup_codes);
  return signingFingerprint;
}

export function isOutsideDirectory(parent, child) {
  const path = relative(parent, child);
  return path === ".." || path.startsWith(".." + sep) || isAbsolute(path);
}

export async function readBackupBundle(options) {
  const manifest = await readEncrypted(
    options.archive,
    options.backupKey,
    FORMAT,
  );
  const escrow = await readEncrypted(
    options.escrow,
    options.backupKey,
    FORMAT + ":keys",
  );
  assert.ok(
    manifest.format === FORMAT &&
      escrow.format === FORMAT &&
      manifest.id === escrow.id,
    "Archive and key escrow must match",
  );
  const recovery = recoveryMaterial(escrow);
  assert.equal(manifest.browserSigningFingerprint??null,browserSigningRecovery(recovery.browserSigningKeyPem)?.fingerprint??null,"Browser signing escrow must match the archive");
  assert.ok(
    typeof manifest.dump === "string" && Array.isArray(manifest.tables),
    "Archive manifest is invalid",
  );
  const dump = Buffer.from(manifest.dump, "base64");
  assert.ok(
    dump.length <= LIMIT &&
      dump.toString("base64") === manifest.dump &&
      digest(dump) === manifest.dumpSha256 &&
      dump.subarray(0, 5).equals(Buffer.from("PGDMP")),
    "Database archive integrity check failed",
  );
  return { manifest, dump, recovery };
}
