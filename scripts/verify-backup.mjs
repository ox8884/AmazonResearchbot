import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {createPrivateKey,generateKeyPairSync,sign,verify} from 'node:crypto';
import { removeTestRestore } from "./support/backup-test-cleanup.mjs";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { openAcceptance } from "./support/acceptance.mjs";
import { createOrderFixture } from "./support/order-fixture.mjs";
import { createPool } from "../packages/db/src/client.ts";
import {
  decryptSecret,
  encryptSecret,
} from "../packages/security/src/secrets.ts";
import {
  createLocalBackup,
  restoreLocalBackup,
} from "./support/local-backup.mjs";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { target: { type: "string" } },
});
assert.equal(
  values.target ?? "isolated",
  "isolated",
  "Restore acceptance only supports isolated targets",
);
const authSecret = randomBytes(32).toString("hex"),
  encryptionKeyHex = randomBytes(32).toString("hex");
const backupKey = randomBytes(32);
const test = await openAcceptance({
  databaseKey: "backup-" + Date.now(),
  authSecret,
  encryptionKeyHex,
});
const directory = resolve("data/backup-acceptance-" + test.runId);
let restored, restoredName;
try {
  const subject = await createOrderFixture(test, "backup");
  const packet = await test.call(
    `/api/candidates/${subject.id}/order-packets`,
    {
      quoteId: subject.quoteId,
      decision: "hold",
      note: "Synthetic restore verification",
    },
  );
  assert.equal(packet.status, 201);
  const csv = Buffer.from("keyword\nbackup-source-" + test.runId + "\n");
  const sourceHash = createHash("sha256").update(csv).digest("hex");
  await test.pool.query(
    "INSERT INTO imports(filename,byte_size,sha256,source_type,schema_version,marketplace,blob_ciphertext) VALUES('restore.csv',$1,$2,'synthetic','1','us',$3)",
    [
      csv.length,
      sourceHash,
      encryptSecret(
        csv,
        Buffer.from(encryptionKeyHex, "hex"),
        "import:restore.csv:bytes",
      ),
    ],
  );
  await mkdir(directory, { recursive: true });
  const backupOptions = {
    databaseUrl: test.databaseUrl,
    backupKey,
    outputDirectory: directory,
    escrowDirectory: resolve(directory, "../escrow-" + test.runId),
    recovery: { authSecret, encryptionKeyHex },
  };
  await assert.rejects(
    createLocalBackup({
      ...backupOptions,
      recovery: {
        authSecret,
        encryptionKeyHex: randomBytes(32).toString("hex"),
      },
    }),
  );
  await assert.rejects(
    createLocalBackup({
      ...backupOptions,
      recovery: {
        authSecret: randomBytes(32).toString("hex"),
        encryptionKeyHex,
      },
    }),
  );
  const signing=browserSigningFixture();
  await publishBrowserSigningIdentity(test.pool,signing.privateKey);
  await assert.rejects(createLocalBackup(backupOptions),/BROWSER_SIGNING_RECOVERY_REQUIRED/);
  const browserSigningKeyPem=signing.privateKey.export({format:'pem',type:'pkcs8'}).toString();
  await assert.rejects(createLocalBackup({...backupOptions,recovery:{...backupOptions.recovery,browserSigningKeyPem:generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}).toString()}}),/BROWSER_SIGNING_RECOVERY_REQUIRED/);
  await assert.rejects(createLocalBackup({...backupOptions,recovery:{...backupOptions.recovery,browserSigningKeyPem:'invalid'}}),/INVALID_BROWSER_SIGNING_RECOVERY/);
  backupOptions.recovery.browserSigningKeyPem=browserSigningKeyPem;
  const backup = await createLocalBackup(backupOptions);
  const bytes = await readFile(backup.archive);
  const encryptedKeys=await readFile(backup.escrow);
  assert.ok(!bytes.includes(Buffer.from(browserSigningKeyPem))&&!encryptedKeys.includes(Buffer.from(browserSigningKeyPem)));
  assert.equal(
    bytes.includes(Buffer.from("backup-source-" + test.runId)),
    false,
  );
  assert.equal(bytes.includes(Buffer.from(authSecret)), false);
  const databaseCount = async () =>
    Number(
      (
        await test.pool.query(
          "SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'forge_ops_restore_%'",
        )
      ).rows[0].n,
    );
  const before = await databaseCount();
  await assert.rejects(
    createLocalBackup({
      databaseUrl: test.databaseUrl,
      backupKey,
      outputDirectory: directory,
      escrowDirectory: directory,
      recovery: { authSecret, encryptionKeyHex },
    }),
  );
  await assert.rejects(
    restoreLocalBackup({
      archive: backup.archive,
      escrow: backup.escrow,
      backupKey,
      adminUrl: test.databaseUrl + "?host=external.invalid",
    }),
  );
  assert.equal(
    await databaseCount(),
    before,
    "Unsafe target must be rejected before any database creation",
  );
  await assert.rejects(
    restoreLocalBackup({
      archive: backup.archive,
      escrow: backup.escrow,
      backupKey: randomBytes(32),
      adminUrl: test.databaseUrl,
    }),
  );
  assert.equal(
    await databaseCount(),
    before,
    "Wrong key must fail before creating a database",
  );
  const damaged = resolve(directory, "damaged.fops");
  const changed = Buffer.from(bytes);
  changed[Math.floor(changed.length / 2)] ^= 1;
  await writeFile(damaged, changed, { flag: "wx" });
  await assert.rejects(
    restoreLocalBackup({
      archive: damaged,
      escrow: backup.escrow,
      backupKey,
      adminUrl: test.databaseUrl,
    }),
  );
  assert.equal(
    await databaseCount(),
    before,
    "Tampered archive must fail before creating a database",
  );
  const result = await restoreLocalBackup({
    archive: backup.archive,
    escrow: backup.escrow,
    backupKey,
    adminUrl: test.databaseUrl,
  });
  restoredName = new URL(result.databaseUrl).pathname.slice(1);
  restored = createPool(result.databaseUrl);
  assert.equal(
    (
      await restored.query(
        "SELECT count(*)::int AS n FROM candidates WHERE id=$1",
        [subject.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await restored.query(
        "SELECT count(*)::int AS n FROM supplier_quotes WHERE id=$1",
        [subject.quoteId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await restored.query(
        "SELECT count(*)::int AS n FROM order_packets WHERE id=$1",
        [packet.body.packet.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await restored.query(
        "SELECT count(*)::int AS n FROM deployment_identity WHERE environment='development'",
      )
    ).rows[0].n,
    0,
    "Restored DB cannot start a development worker",
  );
  const source = (
    await restored.query(
      "SELECT blob_ciphertext FROM imports WHERE sha256=$1",
      [sourceHash],
    )
  ).rows[0];
  assert.deepEqual(
    decryptSecret(
      source.blob_ciphertext,
      Buffer.from(result.recovery.encryptionKeyHex, "hex"),
      "import:restore.csv:bytes",
    ),
    csv,
  );
  assert.equal(result.recovery.authSecret, authSecret);
  assert.ok(typeof result.recovery.browserSigningKeyPem==='string','Restored escrow must retain the signing key');
  const proof=Buffer.from('Synthetic restored signing verification');
  const restoredSignature=sign(null,proof,createPrivateKey(result.recovery.browserSigningKeyPem));
  assert.equal(verify(null,proof,signing.publicKey,restoredSignature),true);
  assert.equal(
    (
      await test.pool.query(
        "SELECT count(*)::int AS n FROM deployment_identity WHERE environment='development'",
      )
    ).rows[0].n,
    1,
    "Source database is unchanged",
  );
  await unlink(damaged);
  console.log(
    JSON.stringify({
      scenario: "backup-restore",
      result: "PASS",
      encrypted: true,
      wrongRecoveryKeysDenied: true,
      wrongKeyBeforeCreate: true,
      tamperBeforeCreate: true,
      candidateQuoteApprovalRestored: true,
      sourceBytesDecrypted: true,
      workerQuarantined: true,
      restoredSigningKeyVerified: true,
      restoredDatabase: new URL(result.databaseUrl).pathname.slice(1),
      externalCalls: 0,
    }),
  );
} finally {
  if (restored) await restored.end();
  try {
    if (restoredName) await removeTestRestore(test, restoredName);
  } finally {
    await test.close();
  }
}
