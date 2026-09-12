import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  createRecoveryCodeStorage,
  migrateLegacyRecoveryCodeStorage,
  prepareRecoveryCodeStorage,
} from "../apps/api/src/recovery-code-storage.ts";
import { openAcceptance } from "./support/acceptance.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { symmetricEncrypt } = await import(pathToFileURL(requireFromApi.resolve("better-auth/crypto")).href);

function parseCodeList(value) {
  const parsed = JSON.parse(value);
  assert.ok(Array.isArray(parsed));
  const codes = [];
  for (const code of parsed) {
    assert.equal(typeof code, "string");
    codes.push(code);
  }
  return codes;
}

const secret = "recovery-storage-test-secret-0123456789";
const rawCodes = ["ALPHA-11111", "BRAVO-22222", "CHARL-33333"];
const storage = createRecoveryCodeStorage(secret);
const stored = await storage.encrypt(JSON.stringify(rawCodes));
assert.equal(stored.includes(rawCodes[0]), false);
assert.equal(stored.includes(rawCodes[1]), false);
const hashedCodes = parseCodeList(await storage.decrypt(stored));
assert.deepEqual(hashedCodes, rawCodes.map((code) => storage.hashInput(code)));
const remaining = hashedCodes.filter((code) => code !== storage.hashInput(rawCodes[0]));
const remainingStored = await storage.encrypt(JSON.stringify(remaining));
assert.deepEqual(parseCodeList(await storage.decrypt(remainingStored)), remaining);
assert.equal(remainingStored.includes(rawCodes[1]), false);
const storedHashAsCode = storage.hashInput(hashedCodes[0]);
assert.notEqual(storedHashAsCode, hashedCodes[0]);
assert.equal(hashedCodes.includes(storedHashAsCode), false);
const finalCharacter = stored.at(-1);
if (finalCharacter === undefined) throw new Error("Stored fixture missing");
const tampered = `${stored.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;
await assert.rejects(storage.decrypt(tampered));

const legacyStored = await symmetricEncrypt({ key: secret, data: JSON.stringify(rawCodes) });
assert.deepEqual(parseCodeList(await storage.decrypt(legacyStored)), hashedCodes);

const test = await openAcceptance({ databaseKey: `recovery-storage-${process.pid}-${Date.now().toString(36)}`, authSecret: secret });
try {
  const user = await test.pool.query("SELECT id FROM \"user\" WHERE email=$1", [test.authFixture.email]);
  const userId = user.rows[0]?.id;
  if (userId === undefined) throw new Error("Acceptance user missing");
  const rowId=(await test.pool.query("SELECT id FROM two_factor WHERE user_id=$1",[userId])).rows[0].id;
  await test.pool.query("UPDATE two_factor SET backup_codes=$1 WHERE id=$2",[legacyStored,rowId]);
  assert.deepEqual(await migrateLegacyRecoveryCodeStorage(test.pool, storage, { twoFactorId: rowId }), { changedCount: 1 });
  const migrated = await test.pool.query("SELECT backup_codes FROM two_factor WHERE id=$1", [rowId]);
  const migratedStored = migrated.rows[0]?.backup_codes;
  assert.equal(typeof migratedStored, "string");
  assert.equal(migratedStored.includes(rawCodes[2]), false);
  assert.deepEqual(parseCodeList(await storage.decrypt(migratedStored)), hashedCodes);
  assert.deepEqual(await migrateLegacyRecoveryCodeStorage(test.pool, storage, { twoFactorId: rowId }), { changedCount: 0 });
  for (const label of ["aa-valid","zz-invalid"]) {
    const id=label+test.runId;
    await test.pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,"Migration fixture",id+"@fixture.invalid"]);
    await test.pool.query("INSERT INTO two_factor(id,secret,backup_codes,user_id,verified) VALUES($1,'fixture-only',$2,$1,false)",[id,label==="aa-valid"?legacyStored:"frc1.invalid.invalid"]);
  }
  await assert.rejects(prepareRecoveryCodeStorage(test.pool,secret));
  assert.equal((await test.pool.query("SELECT backup_codes FROM two_factor WHERE id=$1",["aa-valid"+test.runId])).rows[0].backup_codes,legacyStored,"A malformed row rolls the entire startup conversion back");
  await test.pool.query("UPDATE two_factor SET backup_codes=$2 WHERE id=$1",["zz-invalid"+test.runId,await storage.encrypt(JSON.stringify(rawCodes))]);
  assert.deepEqual(await prepareRecoveryCodeStorage(test.pool,secret),{changedCount:1});
  assert.deepEqual(await prepareRecoveryCodeStorage(test.pool,secret),{changedCount:0});
  console.log(JSON.stringify({ scenario: "recovery-storage", result: "PASS", plaintextOutput: false, atomicStartupMigration: true, legacyMigration: true, changedCountOnly: true }));
} finally {
  await test.close();
}
