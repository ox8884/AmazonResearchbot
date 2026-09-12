import {browserSigningFixture} from './support/browser-signing-fixture.mjs';
import {publishBrowserSigningIdentity} from '../apps/worker/src/browser-signing-key.ts';
import {readBackupBundle} from './support/backup-archive.mjs';
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, rm, realpath } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openAcceptance } from "./support/acceptance.mjs";
import { runDailyBackup } from "./support/daily-backup.mjs";
const authSecret = randomBytes(32).toString("hex"),
  encryptionKeyHex = randomBytes(32).toString("hex");
const test = await openAcceptance({
  databaseKey: "daily-backup-" + Date.now(),
  authSecret,
  encryptionKeyHex,
});
const signingFile=resolve('data/daily-signing-key-'+test.runId+'.pem');
const keyFile = resolve("data/daily-backup-key-" + test.runId + ".hex");
const outputDirectory = resolve("data/daily-backup-" + test.runId),
  escrowDirectory = resolve("data/daily-escrow-" + test.runId);
const options = {
  databaseUrl: test.databaseUrl,
  keyFile,
  outputDirectory,
  escrowDirectory,
  recovery: { authSecret, encryptionKeyHex },
};
const completed = async () =>
  Number(
    (
      await test.pool.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE actor='local-backup' AND action='backup_completed'",
      )
    ).rows[0].n,
  );
let damaged;
const ownedDirectories = [];
try {
  for (const directory of [outputDirectory, escrowDirectory]) {
    await mkdir(directory, { mode: 0o700 });
    ownedDirectories.push(directory);
  }
  assert.equal((await runDailyBackup(options)).kind, "unconfigured");
  await writeFile(keyFile, randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
  await assert.rejects(
    runDailyBackup({
      ...options,
      recovery: {
        authSecret: randomBytes(32).toString("hex"),
        encryptionKeyHex,
      },
    }),
  );
  assert.equal(
    await completed(),
    0,
    "Failed backups cannot produce completion records",
  );
  await test.pool.query(
    "CREATE FUNCTION qa_backup_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor='local-backup' AND NEW.action='backup_completed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$",
  );
  await test.pool.query(
    "CREATE TRIGGER qa_backup_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_backup_audit_failure()",
  );
  try {
    await assert.rejects(runDailyBackup(options));
    assert.equal(
      await completed(),
      0,
      "A failed completion write cannot report success",
    );
  } finally {
    await test.pool.query(
      "DROP TRIGGER qa_backup_audit_failure ON audit_events",
    );
    await test.pool.query("DROP FUNCTION qa_backup_audit_failure()");
  }
  const results = await Promise.all([
    runDailyBackup(options),
    runDailyBackup(options),
    runDailyBackup(options),
  ]);
  const created = results.filter((r) => r.kind === "created");
  assert.equal(created.length, 1);
  assert.equal(await completed(), 1, "Concurrent producers complete once");
  const first = created[0];
  assert.equal((await runDailyBackup(options)).kind, "existing");
  const env = {
    ...process.env,
    APP_ENV: "development",
    BROWSER_SIGNING_KEY_FILE: "",
    BROWSER_TASKS_ENABLED: "false",
    DATABASE_URL: test.databaseUrl,
    BETTER_AUTH_SECRET: authSecret,
    ENCRYPTION_KEY: encryptionKeyHex,
    LOCAL_BACKUP_KEY_FILE: keyFile,
    LOCAL_BACKUP_DIRECTORY: outputDirectory,
    LOCAL_BACKUP_ESCROW_DIRECTORY: escrowDirectory,
  };
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "scripts/backup-scheduler.mjs", "--once"],
    { env, timeout: 120000 },
  );
  assert.equal(
    JSON.parse(result.stdout).kind,
    "existing",
    "A new process must reuse the completed daily backup",
  );
  assert.equal(await completed(), 1);
  damaged = first.archive;
  await writeFile(damaged, "synthetic damaged archive");
  const repaired = await runDailyBackup(options);
  assert.equal(repaired.kind, "created");
  assert.notEqual(repaired.id, first.id);
  assert.equal(
    await completed(),
    2,
    "Corrupted completed files require a new valid backup",
  );
  await writeFile(keyFile, randomBytes(32).toString("hex"));
  assert.equal(
    (await runDailyBackup(options)).kind,
    "created",
    "A new backup key requires a matching encrypted backup",
  );
  assert.equal((await runDailyBackup(options)).kind, "existing");
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  assert.equal(
    (await runDailyBackup({ ...options, now: tomorrow })).kind,
    "created",
  );
  assert.equal(
    (await runDailyBackup({ ...options, now: tomorrow })).kind,
    "existing",
  );
  assert.equal(await completed(), 4);
  const signing=browserSigningFixture();
  await publishBrowserSigningIdentity(test.pool,signing.privateKey);
  await assert.rejects(runDailyBackup(options),/BROWSER_SIGNING_RECOVERY_REQUIRED/,'A previous same-day backup cannot conceal a missing signing key');
  await writeFile(signingFile,signing.privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
  const signedProcess=await promisify(execFile)(process.execPath,['--import','tsx','scripts/backup-scheduler.mjs','--once'],{env:{...env,BROWSER_TASKS_ENABLED:'false',BROWSER_SIGNING_KEY_FILE:signingFile},timeout:120000});
  const signed=JSON.parse(signedProcess.stdout);
  assert.equal(signed.kind,'created','New signing identity requires a fresh backup on the same day');
  const currentBackupKey=Buffer.from((await readFile(keyFile,'utf8')).trim(),'hex');
  const bundle=await readBackupBundle({...signed,backupKey:currentBackupKey});
  assert.ok(typeof bundle.recovery.browserSigningKeyPem==='string');
  assert.equal((await runDailyBackup({...options,recovery:bundle.recovery})).kind,'existing');
  assert.equal(await completed(),5);

  console.log(
    JSON.stringify({
      scenario: "daily-backup",
      result: "PASS",
      missingKeyNotSuccess: true,
      failureNotCompleted: true,
      completionWriteFailureRecovered: true,
      keyRotationRebacked: true,
      concurrentOnce: true,
      newProcessOnce: true,
      corruptionRecovered: true,
      nextDayOnce: true,
      signingIdentitySameDayRebacked: true,
      actualSchedulerSigningKeyLoaded: true,
      externalCalls: 0,
    }),
  );
} finally {
  try {
    for (const file of [keyFile, signingFile, damaged].filter(Boolean)) {
      try {
        await unlink(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const dataRoot = await realpath(resolve("data"));
    for (const directory of ownedDirectories) {
      assert.ok([outputDirectory, escrowDirectory].includes(directory));
      const target = await realpath(directory);
      assert.equal(
        dirname(target),
        dataRoot,
        "Cleanup must remain in the fixture data root",
      );
      assert.equal(
        basename(target),
        basename(directory),
        "Cleanup cannot follow a redirected fixture directory",
      );
      await rm(directory, { recursive: true });
    }
  } finally {
    await test.close();
  }
}
