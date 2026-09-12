import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool } from "../../packages/db/src/client.ts";
import { encryptSecret } from "../../packages/security/src/secrets.ts";
import {
  isOutsideDirectory,
  FORMAT,
  digest,
  localUrl,
  docker,
  fingerprints,
  recoveryMaterial,
  verifyRecoveryMaterial,
  readBackupBundle,
} from "./backup-archive.mjs";

export async function createLocalBackup(options) {
  const url = localUrl(options.databaseUrl),
    recovery = recoveryMaterial(options.recovery);
  assert.equal(options.backupKey.length, 32, "Backup key must be 32 bytes");
  const output = resolve(options.outputDirectory),
    escrowRoot = resolve(options.escrowDirectory);
  assert.ok(
    isOutsideDirectory(output, escrowRoot),
    "Key escrow must be outside the archive directory",
  );
  const pool = createPool(url.toString()),
    db = await pool.connect();
  let transaction = false;
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM deployment_identity WHERE environment='development'",
        )
      ).rows[0].n,
      1,
      "Development source required",
    );
    const snapshot = (await db.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id;
    const browserSigningFingerprint=await verifyRecoveryMaterial(db, recovery);
    const rows = await fingerprints(db);
    const dump = await docker([
      "pg_dump",
      "-U",
      "forge",
      "-d",
      url.pathname.slice(1),
      "-Fc",
      "--no-owner",
      "--no-acl",
      "--snapshot=" + snapshot,
    ]);
    assert.ok(
      dump.subarray(0, 5).equals(Buffer.from("PGDMP")),
      "Expected a PostgreSQL custom archive",
    );
    const id = randomUUID();
    const manifest = {
      format: FORMAT,
      id,
      createdAt: new Date().toISOString(),
      sourceDatabase: url.pathname.slice(1),
      browserSigningFingerprint,
      storage: "encrypted-blobs-in-database",
      roleMapping:
        "restore objects as local forge; original ownership and ACL not applied",
      tables: rows,
      dumpSha256: digest(dump),
      dump: dump.toString("base64"),
    };
    await db.query("COMMIT");
    transaction = false;
    await mkdir(output, { recursive: true, mode: 0o700 });
    await mkdir(escrowRoot, { recursive: true, mode: 0o700 });
    const archive = resolve(output, id + ".fops"),
      escrow = resolve(escrowRoot, id + ".keys.fops");
    await writeFile(
      escrow,
      encryptSecret(
        Buffer.from(JSON.stringify({ format: FORMAT, id, ...recovery })),
        options.backupKey,
        FORMAT + ":keys",
      ),
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      archive,
      encryptSecret(
        Buffer.from(JSON.stringify(manifest)),
        options.backupKey,
        FORMAT,
      ),
      { flag: "wx", mode: 0o600 },
    );
    return {
      archive,
      escrow,
      id,
      tableCount: rows.length,
      dumpBytes: dump.length,
    };
  } finally {
    try {
      if (transaction) await db.query("ROLLBACK");
    } finally {
      db.release();
      await pool.end();
    }
  }
}

export async function restoreLocalBackup(options) {
  const url = localUrl(options.adminUrl);
  const { manifest, dump, recovery } = await readBackupBundle(options);
  const admin = createPool(url.toString());
  let restored, lease;
  const name = "forge_ops_restore_" + randomUUID().replaceAll("-", "");
  try {
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM deployment_identity WHERE environment='development'",
        )
      ).rows[0].n,
      1,
      "Development admin database required",
    );
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = "/" + name;
    restored = createPool(url.toString());
    lease = await restored.connect();
    await lease.query(
      "SELECT pg_advisory_lock(hashtext('forge_ops.worker_authority'))",
    );
    await docker(
      [
        "pg_restore",
        "-U",
        "forge",
        "-d",
        name,
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-acl",
      ],
      dump,
    );
    let actual;
    try {
      actual = await fingerprints(lease);
      await verifyRecoveryMaterial(lease, recovery);
    } finally {
      await lease.query(
        "UPDATE deployment_identity SET environment='restore_quarantine',worker_identity='restore-verification-only',updated_at=now()",
      );
    }
    assert.deepEqual(
      actual,
      manifest.tables,
      "Restored table counts and hashes must match the snapshot",
    );
    return {
      databaseUrl: url.toString(),
      recovery,
      tableCount: actual.length,
      quarantined: true,
    };
  } finally {
    if (lease) {
      lease.release();
      await restored.end();
    }
    await admin.end();
  }
}
