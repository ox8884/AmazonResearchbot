import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {readBackupBundle} from './support/backup-archive.mjs';
import { removeTestRestore } from "./support/backup-test-cleanup.mjs";
import { createPool } from "../packages/db/src/client.ts";
import {
  encryptSecret,
  decryptSecret,
} from "../packages/security/src/secrets.ts";
import { FORMAT } from "./support/backup-archive.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes,generateKeyPairSync } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { openAcceptance } from "./support/acceptance.mjs";
const run = promisify(execFile),
  authSecret = randomBytes(32).toString("hex"),
  encryptionKeyHex = randomBytes(32).toString("hex");
const test = await openAcceptance({
  databaseKey: "backup-cli-" + Date.now(),
  authSecret,
  encryptionKeyHex,
});
const backupKey = randomBytes(32);
const altered = resolve("data/backup-test-altered-" + test.runId + ".fops");
const signingFile=resolve('data/backup-cli-signing-'+test.runId+'.pem');
const keyFile = resolve("data/backup-test-key-" + test.runId + ".hex");
const cleanup = new Set();
const env = {
  ...process.env,
  APP_ENV: "development",
  BROWSER_SIGNING_KEY_FILE: "",
  BROWSER_TASKS_ENABLED: "false",
  DATABASE_URL: test.databaseUrl,
  BETTER_AUTH_SECRET: authSecret,
  ENCRYPTION_KEY: encryptionKeyHex,
  MAIL_TRANSPORT: "disabled",
};
const cli = (args, extraEnv = {}) =>
  run(
    process.execPath,
    ["--import", "tsx", "scripts/backup-local.mjs", ...args],
    { env: { ...env, ...extraEnv }, timeout: 120000 },
  );
try {
  await writeFile(keyFile, backupKey.toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
  const backupArgs = [
    "backup",
    "--key-file",
    keyFile,
    "--output",
    resolve("data/backup-cli-" + test.runId),
    "--escrow-dir",
    resolve("data/backup-cli-escrow-" + test.runId),
  ];
  const first = JSON.parse((await cli(backupArgs)).stdout),
    second = JSON.parse((await cli(backupArgs)).stdout);
  assert.equal(first.status, "encrypted-local-backup-created");
  assert.ok(!Object.hasOwn((await readBackupBundle({...first,backupKey})).recovery,"browserSigningKeyPem"),"Synthetic backup must not inherit the main signing key");
  assert.notEqual(first.archive, second.archive);
  const count = async () =>
    Number(
      (
        await test.pool.query(
          "SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'forge_ops_restore_%'",
        )
      ).rows[0].n,
    );
  const before = await count();
  await assert.rejects(
    cli([
      ...backupArgs.slice(0, -1),
      resolve("data/backup-cli-" + test.runId, "..nested"),
    ]),
  );
  await assert.rejects(cli(backupArgs, { APP_ENV: "production" }));
  await assert.rejects(
    cli([
      "restore",
      "--target",
      "existing",
      "--key-file",
      keyFile,
      "--archive",
      first.archive,
      "--escrow",
      first.escrow,
    ]),
  );
  await assert.rejects(
    cli([
      "restore",
      "--target",
      "isolated",
      "--key-file",
      keyFile,
      "--archive",
      first.archive,
      "--escrow",
      second.escrow,
    ]),
  );
  assert.equal(
    await count(),
    before,
    "Rejected commands cannot create a database",
  );
  const legacy=JSON.parse(decryptSecret(await readFile(first.archive,'utf8'),backupKey,FORMAT).toString());
  delete legacy.browserSigningFingerprint;
  await writeFile(first.archive,encryptSecret(Buffer.from(JSON.stringify(legacy)),backupKey,FORMAT));
  const restored = JSON.parse(
    (
      await cli([
        "restore",
        "--target",
        "isolated",
        "--key-file",
        keyFile,
        "--archive",
        first.archive,
        "--escrow",
        first.escrow,
      ])
    ).stdout,
  );
  cleanup.add(restored.database);
  assert.equal(restored.worker, "quarantined");
  const url = new URL(test.databaseUrl);
  url.pathname = "/" + restored.database;
  await assert.rejects(
    run(process.execPath, ["--import", "tsx", "apps/worker/src/index.ts"], {
      env: { ...env, DATABASE_URL: url.toString() },
      timeout: 15000,
    }),
    (error) => error.code === 1 && error.stderr.includes("RUNTIME_AUTHORITY_REQUIRED"),
  );
  const names = async () =>
    new Set(
      (
        await test.pool.query(
          "SELECT datname FROM pg_database WHERE datname LIKE 'forge_ops_restore_%'",
        )
      ).rows.map((row) => row.datname),
    );
  const beforeMismatch = await names();
  const manifest = JSON.parse(
    decryptSecret(
      await readFile(first.archive, "utf8"),
      backupKey,
      FORMAT,
    ).toString("utf8"),
  );
  manifest.tables[0].sha256 = "0".repeat(64);
  await writeFile(
    altered,
    encryptSecret(Buffer.from(JSON.stringify(manifest)), backupKey, FORMAT),
    { flag: "wx" },
  );
  await assert.rejects(
    cli([
      "restore",
      "--target",
      "isolated",
      "--key-file",
      keyFile,
      "--archive",
      altered,
      "--escrow",
      first.escrow,
    ]),
  );
  const created = [...(await names())].filter(
    (name) => !beforeMismatch.has(name),
  );
  assert.equal(created.length, 1);
  cleanup.add(created[0]);
  const failedUrl = new URL(test.databaseUrl);
  failedUrl.pathname = "/" + created[0];
  const failed = createPool(failedUrl.toString());
  try {
    assert.equal(
      (
        await failed.query(
          "SELECT count(*)::int AS n FROM deployment_identity WHERE environment='restore_quarantine'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await failed.end();
  }
  const signing=browserSigningFixture();
  await publishBrowserSigningIdentity(test.pool,signing.privateKey);
  await assert.rejects(cli(backupArgs,{BROWSER_SIGNING_KEY_FILE:''}));
  await writeFile(signingFile,signing.privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
  const signedOutput=await cli(backupArgs,{BROWSER_SIGNING_KEY_FILE:signingFile,BROWSER_TASKS_ENABLED:'false'});
  assert.equal(signedOutput.stdout.includes('PRIVATE KEY'),false);
  const signed=JSON.parse(signedOutput.stdout);
  const signedBundle=await readBackupBundle({...signed,backupKey});
  assert.ok(typeof signedBundle.recovery.browserSigningKeyPem==='string');
  assert.equal(JSON.stringify(signedBundle.manifest).includes('PRIVATE KEY'),false);
  const mismatched=JSON.parse(decryptSecret(await readFile(signed.escrow,'utf8'),backupKey,FORMAT+':keys').toString());
  mismatched.browserSigningKeyPem=generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}).toString();
  await writeFile(altered,encryptSecret(Buffer.from(JSON.stringify(mismatched)),backupKey,FORMAT+':keys'));
  const beforeKeyMismatch=await count();
  await assert.rejects(cli(['restore','--target','isolated','--key-file',keyFile,'--archive',signed.archive,'--escrow',altered]));
  assert.equal(await count(),beforeKeyMismatch,'Mismatched signing escrow is rejected before creating a database');
  console.log(
    JSON.stringify({
      scenario: "backup-cli",
      result: "PASS",
      backupRestore: true,
      legacyManifestRestored: true,
      cliSigningKeyEscrow: true,
      mismatchedSigningEscrowBeforeCreate: true,
      separateEscrowBound: true,
      productionDenied: true,
      existingTargetDenied: true,
      actualWorkerStartDenied: true,
      failedVerificationQuarantined: true,
      externalCalls: 0,
    }),
  );
} finally {
  try {
    for (const file of [keyFile, signingFile, altered]) {
      try {
        await unlink(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  } finally {
    try {
      for (const name of cleanup) await removeTestRestore(test, name);
    } finally {
      await test.close();
    }
  }
}
