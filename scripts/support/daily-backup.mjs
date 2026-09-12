import {verifyBrowserSigningRecovery} from "./browser-signing-recovery.mjs";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../../packages/db/src/client.ts";
import { parseKey } from "../../packages/security/src/secrets.ts";
import { createLocalBackup } from "./local-backup.mjs";
import {
  localUrl,
  digest,
  LIMIT,
  readBackupBundle,
} from "./backup-archive.mjs";
import { backupLocations } from "./backup-locations.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
async function fileHash(path) {
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      size += chunk.length;
      if (size >= LIMIT * 3) throw new Error("Backup file too large");
      hash.update(chunk);
    }
    return hash.digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function runDailyBackup(options) {
  const locations = backupLocations(root, options),
    url = localUrl(options.databaseUrl);
  let keyText;
  try {
    keyText = await readFile(locations.keyFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "unconfigured" };
    throw error;
  }
  const backupKey = parseKey(keyText),
    keyFingerprint = digest(backupKey);
  const pool = createPool(url.toString());
  let client,
    locked = false,
    discard = false;
  try {
    client = await pool.connect();
    if (
      (
        await client.query(
          "SELECT count(*)::int AS n FROM deployment_identity WHERE environment='development'",
        )
      ).rows[0].n !== 1
    )
      throw new Error("Development database required");
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtext('forge.local.daily-backup')) AS locked",
      )
    ).rows[0].locked;
    if (!locked) return { kind: "busy" };
    const now =
      options.now ??
      (await client.query("SELECT clock_timestamp() AS now")).rows[0].now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw new Error("Invalid backup clock");
    const day = now.toISOString().slice(0, 10);
    const browserSigningFingerprint=await verifyBrowserSigningRecovery(client,options.recovery?.browserSigningKeyPem);
    const previous = (
      await client.query(
        "SELECT meta FROM audit_events WHERE actor='local-backup' AND action='backup_completed' AND target=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
        [day],
      )
    ).rows[0]?.meta;
    if (
      previous &&
      previous.keyFingerprint === keyFingerprint &&
      (previous.browserSigningFingerprint??null) === browserSigningFingerprint &&
      typeof previous.archiveSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(previous.archiveSha256) &&
      typeof previous.escrowSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(previous.escrowSha256) &&
      typeof previous.id === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        previous.id,
      )
    ) {
      const archive = resolve(locations.outputDirectory, previous.id + ".fops"),
        escrow = resolve(locations.escrowDirectory, previous.id + ".keys.fops");
      if (
        (await fileHash(archive)) === previous.archiveSha256 &&
        (await fileHash(escrow)) === previous.escrowSha256
      )
        return { kind: "existing", day, id: previous.id, archive, escrow };
    }
    const result = await createLocalBackup({
      databaseUrl: url.toString(),
      backupKey,
      ...locations,
      recovery: options.recovery,
    });
    const verified = await readBackupBundle({ ...result, backupKey });
    if (
      verified.manifest.id !== result.id ||
      verified.manifest.sourceDatabase !== url.pathname.slice(1)
    )
      throw new Error("Backup verification failed");
    const archiveSha256 = await fileHash(result.archive),
      escrowSha256 = await fileHash(result.escrow);
    if (!archiveSha256 || !escrowSha256)
      throw new Error("Completed backup files missing");
    await client.query(
      "INSERT INTO audit_events(actor,action,target,meta) VALUES('local-backup','backup_completed',$1,$2::jsonb)",
      [
        day,
        JSON.stringify({
          id: result.id,
          keyFingerprint,
          browserSigningFingerprint: verified.manifest.browserSigningFingerprint??null,
          archiveSha256,
          escrowSha256,
          dumpBytes: result.dumpBytes,
          tableCount: result.tableCount,
        }),
      ],
    );
    return { kind: "created", day, ...result };
  } finally {
    if (client && locked) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('forge.local.daily-backup'))",
        );
      } catch {
        discard = true;
      }
    }
    client?.release(discard);
    await pool.end();
  }
}
