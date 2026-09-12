import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openAcceptance } from "./support/acceptance.mjs";
import { decryptSecret, encryptSecret, exactPayloadHash } from "../packages/security/src/index.ts";
import {
  inboxMailboxKey,
  readInboxCursor,
  storeInboxBatch,
} from "../apps/worker/src/inbox-store.ts";
const key = Buffer.from("51".repeat(32), "hex");
const config = Object.freeze({
  name: "Inbox acceptance profile",
  smtpHost: "smtp.mail.example",
  smtpPort: 465,
  imapHost: "imap.mail.example",
  imapPort: 993,
  sender: "buyer@example.com",
  username: "buyer@example.com",
  sentMailbox: "Sent",
  inboxMailbox: "INBOX",
});
let nextRevision = 0;
function message(overrides = {}) {
  return {
    uid: 1,
    messageId: "<supplier-reply@fixture.invalid>",
    inReplyTo: [],
    references: [],
    from: ["supplier@fixture.invalid"],
    to: [config.sender],
    subject: "Ignored by matching",
    receivedAt: "2026-09-06T12:00:00.000Z",
    rawSource: Buffer.from("fixture raw source"),
    bodyText: "Fixture supplier reply",
    contentState: "text",
    attachments: [],
    ...overrides,
  };
}

function batch(mailboxKey, uidValidity, lastUid, messages, observedAt) {
  return { mailboxKey, uidValidity, lastUid, messages, observedAt, hasMore: false };
}

function messageIdFor(actionId) {
  return `<forge-rfq-${actionId}@example.com>`;
}

async function addRfq(pool, candidateId, recipient, label, state = "awaiting_quote", actionState = "sent") {
  const supplier = await pool.query(
    `INSERT INTO sourcing_suppliers(candidate_id,name,email,source,observed_at,match_status,match_notes)
     VALUES($1,$2,$3,'acceptance fixture',now(),'matches','fixture') RETURNING id`,
    [candidateId, `Supplier ${label}`, recipient],
  );
  const spec = await pool.query(
    `INSERT INTO spec_revisions(candidate_id,revision,material,dimensions,packaging,requirements,requested_quantity,source)
     VALUES($1,$2,'fixture','1 cm','fixture','fixture',300,'acceptance fixture') RETURNING id`,
    [candidateId, ++nextRevision],
  );
  const rfq = await pool.query(
    `INSERT INTO rfq_drafts(candidate_id,supplier_id,spec_id,quantity,recipient,subject,body,state)
     VALUES($1,$2,$3,300,$4,$5,'fixture', $6) RETURNING id`,
    [candidateId, supplier.rows[0].id, spec.rows[0].id, recipient, `RFQ ${label}`, state],
  );
  const approval = await pool.query(
    `INSERT INTO approvals(kind,candidate_id,payload_hash,payload,status)
     VALUES('supplier_contact',$1,$2,'{}'::jsonb,'approved') RETURNING id`,
    [candidateId, exactPayloadHash({})],
  );
  const actionId = randomUUID();
  const expectedMessageId = messageIdFor(actionId);
  await pool.query(
    `INSERT INTO external_actions(id,approval_id,rfq_id,payload,payload_hash,state,receipt)
     VALUES($1,$2,$3,'{}'::jsonb,$4,$5,$6)`,
    [
      actionId,
      approval.rows[0].id,
      rfq.rows[0].id,
      exactPayloadHash({}),
      actionState,
      JSON.stringify({ transport: "fixture", messageId: expectedMessageId }),
    ],
  );
  return { actionId, expectedMessageId, rfqId: rfq.rows[0].id };
}

const test = await openAcceptance({
  databaseKey: `inbox-store-${process.pid}-${Date.now().toString(36)}`,
  encryptionKeyHex: key.toString("hex"),
});
try {
  assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE id='0010_inbox.sql'")).rows[0].n, 1);
  const profileId = randomUUID();
  const grant = Object.freeze({ id: profileId, version: 1, secretVersion: 1, config });
  const fingerprint = exactPayloadHash({ profileId, config, secretVersion: 1 });
  await test.pool.query(
    `INSERT INTO mail_profiles(
       id,name,smtp_host,smtp_port,imap_host,imap_port,sender,username,sent_mailbox,inbox_mailbox,
       password_ciphertext,password_last4,secret_version,config_fingerprint,version,status,activated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'1234',1,$12,1,'active',now())`,
    [
      profileId,
      config.name,
      config.smtpHost,
      config.smtpPort,
      config.imapHost,
      config.imapPort,
      config.sender,
      config.username,
      config.sentMailbox,
      config.inboxMailbox,
      encryptSecret(Buffer.from("fixture-password"), key, `mail_profile:${profileId}:1:password`),
      fingerprint,
    ],
  );
  const candidate = await test.pool.query(
    "INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'awaiting_quote') RETURNING id",
    [`inbox-store-${test.runId}`],
  );
  const candidateId = candidate.rows[0].id;
  const primary = await addRfq(test.pool, candidateId, "supplier@fixture.invalid", "primary");
  const mailboxKey = inboxMailboxKey(grant);
  const first = message({
    uid: 5,
    references: [primary.expectedMessageId],
    attachments: [
      {
        part: "1.2",
        filename: "quote.txt",
        mediaType: "text/plain",
        size: 12,
        state: "text",
        bytes: Buffer.from("attachment 01"),
        text: "attachment 01",
      },
    ],
  });
  const firstBatch = batch(mailboxKey, "uidvalidity-A", 5, [first], "2026-09-06T12:01:00.000Z");
  const firstResult = await storeInboxBatch(test.pool, key, { grant, batch: firstBatch });
  assert.deepEqual(firstResult.kind, "stored");
  assert.equal(firstResult.linkedReplies, 1);
  assert.deepEqual(await readInboxCursor(test.pool, grant), { uidValidity: "uidvalidity-A", lastUid: 5 });
  const encrypted = await test.pool.query(
    "SELECT raw_ciphertext FROM inbox_messages WHERE profile_id=$1 AND uid=5",
    [profileId],
  );
  const cipher = encrypted.rows[0].raw_ciphertext;
  assert.equal(
    decryptSecret(cipher, key, `mail_inbox:${profileId}:${mailboxKey}:uidvalidity-A:5:raw`).toString("utf8"),
    "fixture raw source",
  );
  const cipherParts = cipher.split("."), ciphertext = cipherParts[3] ?? "";
  cipherParts[3] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  const tampered = cipherParts.join(".");
  assert.throws(() => decryptSecret(tampered, key, `mail_inbox:${profileId}:${mailboxKey}:uidvalidity-A:5:raw`));
  const attachment = await test.pool.query("SELECT bytes_ciphertext FROM inbox_attachments");
  assert.equal(
    decryptSecret(attachment.rows[0].bytes_ciphertext, key, `mail_inbox:${profileId}:${mailboxKey}:uidvalidity-A:5:attachment:1.2`).toString("utf8"),
    "attachment 01",
  );
  await assert.rejects(test.pool.query("UPDATE inbox_messages SET subject='tamper' WHERE profile_id=$1", [profileId]));

  const parallel = await addRfq(test.pool, candidateId, "supplier@fixture.invalid", "parallel");
  const concurrentX = message({ uid: 1, messageId: "<concurrent-x@fixture.invalid>", references: [primary.expectedMessageId], rawSource: Buffer.from("concurrent x") }), concurrentY = message({ uid: 2, messageId: "<concurrent-y@fixture.invalid>", references: [parallel.expectedMessageId], rawSource: Buffer.from("concurrent y") });
  const replay = await Promise.all([
    storeInboxBatch(test.pool, key, { grant, batch: batch(mailboxKey, "uidvalidity-concurrent-A", 2, [concurrentX, concurrentY], "2026-09-06T12:01:30.000Z") }),
    storeInboxBatch(test.pool, key, { grant, batch: batch(mailboxKey, "uidvalidity-concurrent-B", 2, [{ ...concurrentY, uid: 1 }, { ...concurrentX, uid: 2 }], "2026-09-06T12:01:31.000Z") }),
  ]);
  assert.ok(replay.every((result) => result.kind === "stored"));
  assert.equal(replay.reduce((total, result) => total + result.linkedReplies, 0), 2);
  assert.equal(replay.reduce((total, result) => total + result.duplicateMessages, 0), 2);
  assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM supplier_replies WHERE message_id IN ('<concurrent-x@fixture.invalid>','<concurrent-y@fixture.invalid>')")).rows[0].n, 2);

  const reset = await storeInboxBatch(test.pool, key, {
    grant,
    batch: batch(mailboxKey, "uidvalidity-B", 1, [{ ...first, uid: 1 }], "2026-09-06T11:00:00.000Z"),
  });
  assert.equal(reset.kind, "stored");
  assert.equal(reset.duplicateMessages, 1);
  assert.deepEqual(await readInboxCursor(test.pool, grant), { uidValidity: "uidvalidity-B", lastUid: 1 });
  assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM inbox_mailboxes WHERE profile_id=$1", [profileId])).rows[0].n, 4);

  const changed = await storeInboxBatch(test.pool, key, {
    grant,
    batch: batch(mailboxKey, "uidvalidity-B", 2, [message({ uid: 2, references: [primary.expectedMessageId], rawSource: Buffer.from("changed raw"), bodyText: "changed body" })], "2026-09-06T12:03:00.000Z"),
  });
  assert.equal(changed.kind, "stored"); assert.equal(changed.conflictMessages, 1);
  assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM supplier_replies WHERE message_id='<supplier-reply@fixture.invalid>'")).rows[0].n, 1);

  const ambiguousA = await addRfq(test.pool, candidateId, "supplier@fixture.invalid", "ambiguous-a");
  const ambiguousB = await addRfq(test.pool, candidateId, "supplier@fixture.invalid", "ambiguous-b");
  const mismatch = await addRfq(test.pool, candidateId, "other@fixture.invalid", "mismatch");
  const ambiguousResult = await storeInboxBatch(test.pool, key, {
    grant,
    batch: batch(mailboxKey, "uidvalidity-B", 4, [message({ uid: 3, messageId: "<ambiguous@fixture.invalid>", references: [ambiguousA.expectedMessageId, ambiguousB.expectedMessageId] }), message({ uid: 4, messageId: "<mismatch@fixture.invalid>", references: [mismatch.expectedMessageId] })], "2026-09-06T12:04:00.000Z"),
  });
  assert.equal(ambiguousResult.kind, "stored");
  assert.equal(ambiguousResult.unclassifiedMessages, 2);

  await test.pool.query(
    "INSERT INTO supplier_replies(rfq_id,source,received_at,message_id,body) VALUES($1,'manual',now(),$2,'manual original')",
    [primary.rfqId, "<manual-conflict@fixture.invalid>"],
  );
  const manualConflict = await storeInboxBatch(test.pool, key, {
    grant,
    batch: batch(mailboxKey, "uidvalidity-B", 5, [message({ uid: 5, messageId: "<manual-conflict@fixture.invalid>", references: [primary.expectedMessageId], bodyText: "changed manual body", rawSource: Buffer.from("manual inbound") })], "2026-09-06T12:05:00.000Z"),
  });
  assert.equal(manualConflict.kind, "stored");
  assert.equal(manualConflict.conflictMessages, 1);

  const incomplete = await storeInboxBatch(test.pool, key, {
    grant,
    batch: batch(mailboxKey, "uidvalidity-B", 8, [
      message({ uid: 6, messageId: "<missing-date@fixture.invalid>", references: [primary.expectedMessageId], receivedAt: "not-a-date" }),
      message({ uid: 7, messageId: "<missing-body@fixture.invalid>", references: [primary.expectedMessageId], rawSource: null, bodyText: null, contentState: "too_large" }),
      message({ uid: 8, messageId: null, references: [primary.expectedMessageId], rawSource: Buffer.from("no-id raw") }),
    ], "2026-09-06T12:06:00.000Z"),
  });
  assert.equal(incomplete.kind, "stored");
  assert.equal(incomplete.unclassifiedMessages, 3);
  const flags = await test.pool.query(
    "SELECT received_at,raw_state,body_state,body_ciphertext FROM inbox_messages WHERE profile_id=$1 AND uid IN (6,7) ORDER BY uid",
    [profileId],
  );
  assert.equal(flags.rows[0].received_at, null);
  assert.deepEqual(flags.rows[1], { received_at: new Date("2026-09-06T12:00:00.000Z"), raw_state: "missing", body_state: "too_large", body_ciphertext: null });
  const noIdReplay = await storeInboxBatch(test.pool, key, {
    grant,
    batch: batch(mailboxKey, "uidvalidity-C", 1, [message({ uid: 1, messageId: null, references: [primary.expectedMessageId], rawSource: Buffer.from("no-id raw") })], "2026-09-06T12:07:00.000Z"),
  });
  assert.equal(noIdReplay.kind, "stored");
  assert.equal(noIdReplay.duplicateMessages, 1);

  const uncertainCandidate = await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage,blocked_reason) VALUES('us',$1,$1,'sending_rfq','external_outcome_unknown') RETURNING id", [`uncertain-${test.runId}`]);
  const uncertain = await addRfq(test.pool, uncertainCandidate.rows[0].id, "supplier@fixture.invalid", "uncertain", "outcome_unknown", "outcome_unknown");
  const terminalCandidate = await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'rejected') RETURNING id", [`terminal-${test.runId}`]);
  const terminal = await addRfq(test.pool, terminalCandidate.rows[0].id, "supplier@fixture.invalid", "terminal");
  const protectedResult = await storeInboxBatch(test.pool, key, {
    grant,
    batch: batch(mailboxKey, "uidvalidity-C", 3, [message({ uid: 2, messageId: "<uncertain@fixture.invalid>", references: [uncertain.expectedMessageId] }), message({ uid: 3, messageId: "<terminal@fixture.invalid>", references: [terminal.expectedMessageId] })], "2026-09-06T12:08:00.000Z"),
  });
  assert.equal(protectedResult.kind, "stored");
  assert.equal(protectedResult.unclassifiedMessages, 2);
  assert.deepEqual((await test.pool.query("SELECT stage,blocked_reason FROM candidates WHERE id=$1", [uncertainCandidate.rows[0].id])).rows[0], { stage: "sending_rfq", blocked_reason: "external_outcome_unknown" });
  assert.equal((await test.pool.query("SELECT state FROM external_actions WHERE id=$1", [uncertain.actionId])).rows[0].state, "outcome_unknown");

  const beforeBlocked = (await test.pool.query("SELECT count(*)::int AS n FROM inbox_messages WHERE profile_id=$1", [profileId])).rows[0].n;
  await test.pool.query("UPDATE mail_profiles SET status='disabled' WHERE id=$1", [profileId]);
  const inactive = await storeInboxBatch(test.pool, key, { grant, batch: batch(mailboxKey, "uidvalidity-C", 4, [message({ uid: 4, messageId: "<disabled@fixture.invalid>" })], "2026-09-06T12:09:00.000Z") });
  assert.deepEqual(inactive, { kind: "blocked", reason: "PROFILE_NOT_CURRENT" });
  assert.equal(await readInboxCursor(test.pool, grant), null);
  await test.pool.query("UPDATE mail_profiles SET status='active',version=2,config_fingerprint=$2 WHERE id=$1", [profileId, "0".repeat(64)]);
  const staleGrant = Object.freeze({ ...grant, version: 2 });
  const stale = await storeInboxBatch(test.pool, key, { grant: staleGrant, batch: batch(mailboxKey, "uidvalidity-C", 4, [message({ uid: 4, messageId: "<stale@fixture.invalid>" })], "2026-09-06T12:10:00.000Z") });
  assert.deepEqual(stale, { kind: "blocked", reason: "PROFILE_NOT_CURRENT" });
  assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM inbox_messages WHERE profile_id=$1", [profileId])).rows[0].n, beforeBlocked);
  assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM supplier_quotes")).rows[0].n, 0);
  console.log(JSON.stringify({ scenario: "inbox-storage", result: "PASS", database: test.database, assertions: ["exact-mailbox-key", "active-profile-fingerprint", "concurrency-replay", "uidvalidity-reset", "message-id-conflict", "ambiguous-reference", "from-mismatch", "missing-body-date", "raw-fallback", "terminal-outcome-preserved", "cipher-tamper", "append-only"], externalNetworkCalls: 0 }));
} finally {
  await test.close();
}
