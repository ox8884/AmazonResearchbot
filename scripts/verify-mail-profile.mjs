import { loadEnv } from "../apps/api/src/env.ts";
import { createInboxCycle } from "../apps/worker/src/inbox-loop.ts";
import { resolveWorkMailTransport } from "../apps/worker/src/work-mail.ts";
import { createContactCycle } from "../apps/worker/src/contact-loop.ts";
import assert from "node:assert/strict";
import {decryptSecret} from "../packages/security/src/secrets.ts";
const encryptionKeyHex="41".repeat(32);
import { openAcceptance } from "./support/acceptance.mjs";

const noReadPool={query:async()=>{throw new Error('Unset mode must not read secrets or connect');}};
assert.equal(loadEnv({DATABASE_URL:'postgres://fixture.invalid/fixture',BETTER_AUTH_SECRET:'x'.repeat(32),ENCRYPTION_KEY:encryptionKeyHex}).mailTransport,'disabled');
assert.equal(await resolveWorkMailTransport(noReadPool,Buffer.from(encryptionKeyHex,'hex'),'development',undefined),null);
assert.deepEqual(await createInboxCycle(noReadPool,Buffer.from(encryptionKeyHex,'hex'),{mode:undefined})(),{kind:'disabled'});

const password = "fixture-work-mail-password-90210";
const initialProfile = {
  name: "Fixture work mailbox",
  smtpHost: "smtp.mail.example",
  smtpPort: 465,
  imapHost: "imap.mail.example",
  imapPort: 993,
  sender: "operations@example.com",
  username: "operations@example.com",
  password,
  sentMailbox: "Sent",
  inboxMailbox: "INBOX",
};

const { password: initialPassword, ...profileWithoutPassword } = initialProfile;

const update = (version, changes) => ({
  ...profileWithoutPassword,
  ...changes,
  expectedVersion: version,
});

const test = await openAcceptance({ databaseKey: `mail-profile-${process.pid}-${Date.now().toString(36)}`, encryptionKeyHex, mailTransport: "profile" });
try {
  const initial = await test.call("/api/mail-profile");
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.profile, {
    profileId: null,
    version: null,
    status: "unconfigured",
    configuredFields: null,
    secretConfigured: false,
    last4: null,
    connectionStatus: "unconfigured",
  });

  const wrongOrigin = await test.call("/api/mail-profile", initialProfile, {
    origin: "https://unapproved.invalid",
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.body.code, "ORIGIN_REJECTED");

  const privateHost = await test.call("/api/mail-profile", {
    ...initialProfile,
    smtpHost: "127.0.0.1",
  });
  assert.equal(privateHost.status, 400);
  assert.equal(privateHost.body.code, "MAIL_HOST_INVALID");

  const saves=await Promise.all([test.call("/api/mail-profile",initialProfile),test.call("/api/mail-profile",initialProfile)]);
  assert.deepEqual(saves.map(result=>result.status).sort(),[201,409]);
  const saved=saves.find(result=>result.status===201);assert.ok(saved);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.profile.status, "pending_approval");
  const modeCandidate=(await test.pool.query("INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'imported') RETURNING id",["QA mail mode "+test.runId])).rows[0].id;
  assert.equal((await test.call(`/api/candidates/${modeCandidate}/contact`)).body.deliveryMode,"disabled");
  assert.equal(saved.body.profile.secretConfigured, true);
  assert.equal(saved.body.profile.last4, "0210");
  assert.equal(saved.body.profile.configuredFields.password, undefined);
  assert.equal(saved.body.profile.configuredFields.smtpHost, initialProfile.smtpHost);
  assert.equal(JSON.stringify(saved.body).includes(password), false);
  assert.equal(await resolveWorkMailTransport(test.pool,Buffer.from(encryptionKeyHex,"hex"),"development","profile"),null);
  assert.equal((await test.call("/api/mail-profile",profileWithoutPassword)).status,409,"Existing configuration requires its expected version");
  let resolutions=0;await createContactCycle(test.pool,async()=>{resolutions++;return null;})();assert.equal(resolutions,1);


  const persisted = await test.pool.query(
    "SELECT password_ciphertext,version,secret_version FROM mail_profiles WHERE singleton_key=1",
  );
  assert.equal(persisted.rowCount, 1);
  const stored = persisted.rows[0];
  assert.ok(stored?.password_ciphertext.startsWith("fops1.1."));
  assert.equal(stored?.password_ciphertext.includes(password), false);
  assert.equal(stored?.version, 1);
  assert.equal(stored?.secret_version, 1);
  const audits = await test.pool.query(
    "SELECT meta FROM audit_events WHERE action LIKE 'mail_profile_%' ORDER BY created_at",
  );
  assert.equal(JSON.stringify(audits.rows).includes(password), false);

  const firstProposal = await test.call("/api/mail-profile/activation-proposals", {});
  assert.equal(firstProposal.status, 201);
  const firstPayload = await test.pool.query(
    "SELECT payload FROM approvals WHERE id=$1",
    [firstProposal.body.approvalId],
  );
  assert.equal(JSON.stringify(firstPayload.rows[0]?.payload).includes(password), false);
  assert.equal(JSON.stringify(firstPayload.rows[0]?.payload).includes("password_ciphertext"), false);

  const changedConfig = await test.call(
    "/api/mail-profile",
    update(saved.body.profile.version, { smtpHost: "smtp2.mail.example" }),
  );
  assert.equal(changedConfig.status, 200);
  assert.equal(changedConfig.body.profile.version, 2);
  assert.equal(changedConfig.body.profile.status, "pending_approval");
  const oldApproval = await test.call(
    `/api/approvals/${firstProposal.body.approvalId}/approve`,
    {},
  );
  assert.equal(oldApproval.status, 409);
  assert.equal(oldApproval.body.code, "APPROVAL_STALE");

  const currentProposal = await test.call("/api/mail-profile/activation-proposals", {});
  assert.equal(currentProposal.status, 201);
  const active = await test.call(
    `/api/approvals/${currentProposal.body.approvalId}/approve`,
    {},
  );
  assert.equal(active.status, 200);
  const activeView = await test.call("/api/mail-profile");
  assert.equal(activeView.body.profile.status, "active");
  assert.equal(activeView.body.profile.connectionStatus, "unverified");
  assert.equal((await test.call(`/api/candidates/${modeCandidate}/contact`)).body.deliveryMode,"smtp");
  let secretReads=0,smtpVerifications=0,smtpSends=0;
  const trackedPool=new Proxy(test.pool,{get(target,property){
    if(property==="query")return (sql,...args)=>{if(typeof sql==="string"&&sql.trim().startsWith("SELECT password_ciphertext"))secretReads++;return target.query(sql,...args);};
    const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
  }});
  const fakeClients={createSmtpClient(options){return {verify:async()=>{smtpVerifications++;assert.equal(options.auth.pass,password);return true;},sendMail:async()=>{smtpSends++;throw new Error("No message expected");},close(){}};}};
  const deniedTransport=await resolveWorkMailTransport(trackedPool,Buffer.from(encryptionKeyHex,"hex"),"development","profile",{...fakeClients,resolveHost:async()=>[{address:"127.0.0.1",family:4}]});
  assert.ok(deniedTransport);assert.equal((await deniedTransport.authorize({})).allowed,false);assert.equal(secretReads,0);
  const activeTransport=await resolveWorkMailTransport(trackedPool,Buffer.from(encryptionKeyHex,"hex"),"development","profile",{...fakeClients,resolveHost:async()=>[{address:"8.8.8.8",family:4}]});
  assert.ok(activeTransport);assert.equal((await activeTransport.authorize({})).allowed,true);assert.equal(secretReads,1);assert.equal(smtpVerifications,1);assert.equal(smtpSends,0);
  assert.equal(await resolveWorkMailTransport(test.pool,Buffer.from(encryptionKeyHex,"hex"),"development","disabled"),null);
  assert.equal(await resolveWorkMailTransport(test.pool,Buffer.from(encryptionKeyHex,"hex"),"production","mailpit"),null);


  const changedSecret = await test.call(
    "/api/mail-profile",
    update(activeView.body.profile.version, {
      password: "fixture-work-mail-password-31415",
      smtpHost: "smtp2.mail.example",
    }),
  );
  assert.equal(changedSecret.status, 200);
  assert.equal(changedSecret.body.profile.version, 3);
  assert.equal(changedSecret.body.profile.status, "pending_approval");
  assert.equal((await activeTransport.authorize({})).allowed,false);
  assert.equal((await activeTransport.send({},"unused")).kind,"not_sent");
  assert.equal(secretReads,1);assert.equal(smtpSends,0);


  const encrypted = (await test.pool.query("SELECT id,password_ciphertext,secret_version FROM mail_profiles WHERE singleton_key=1")).rows[0];
  assert.equal(decryptSecret(encrypted.password_ciphertext, Buffer.from(encryptionKeyHex,"hex"), `mail_profile:${encrypted.id}:${encrypted.secret_version}:password`).toString("utf8"), "fixture-work-mail-password-31415", "Secret remains decryptable by its own version after configuration changes");

  const forgedProposal = await test.call("/api/mail-profile/activation-proposals", {});
  assert.equal(forgedProposal.status, 201);
  await test.pool.query(
    "UPDATE approvals SET payload=jsonb_set(payload,'{config,smtpHost}','\"forged.mail.example\"'::jsonb) WHERE id=$1",
    [forgedProposal.body.approvalId],
  );
  const forged = await test.call(
    `/api/approvals/${forgedProposal.body.approvalId}/approve`,
    {},
  );
  assert.equal(forged.status, 409);
  assert.equal(forged.body.code, "APPROVAL_STALE");

  const finalProposal = await test.call("/api/mail-profile/activation-proposals", {});
  assert.equal(finalProposal.status, 201);
  assert.equal(
    (await test.call(`/api/approvals/${finalProposal.body.approvalId}/approve`, {})).status,
    200,
  );
  const enabled = await test.call("/api/mail-profile");
  const disabled = await test.call("/api/mail-profile/disable", {
    expectedVersion: enabled.body.profile.version,
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.profile.status, "disabled");
  assert.equal((await test.call(`/api/candidates/${modeCandidate}/contact`)).body.deliveryMode,"disabled");
  assert.equal(disabled.body.profile.connectionStatus, "unverified");


  const pendingBeforeDisable=await test.call("/api/mail-profile/activation-proposals",{});
  assert.equal(pendingBeforeDisable.status,201);
  await test.call("/api/mail-profile/disable",{expectedVersion:pendingBeforeDisable.body.profile.version});
  const renewed=await test.call("/api/mail-profile/activation-proposals",{});
  assert.equal(renewed.status,201);
  assert.notEqual(renewed.body.approvalId,pendingBeforeDisable.body.approvalId,"Disabling must invalidate the old activation request");
  assert.equal((await test.call(`/api/approvals/${pendingBeforeDisable.body.approvalId}/approve`,{})).status,409);
  assert.equal((await test.call(`/api/approvals/${renewed.body.approvalId}/approve`,{})).status,200);
  const latestView=(await test.call("/api/mail-profile")).body.profile;
  await test.call("/api/mail-profile/disable",{expectedVersion:latestView.version});
  await test.call(`/api/approvals/${renewed.body.approvalId}/approve`,{});
  assert.equal((await test.call("/api/mail-profile")).body.profile.status,"disabled","Approval replay must not reactivate a disabled profile");
  const resume = await test.call("/api/mail-profile/activation-proposals", {});
  assert.equal((await test.call(`/api/approvals/${resume.body.approvalId}/approve`, {})).status,200);
  const beforeFailure=(await test.call("/api/mail-profile")).body.profile;
  const rejectedTransport=await resolveWorkMailTransport(test.pool,Buffer.from(encryptionKeyHex,"hex"),"development","profile",{
    resolveHost:async()=>[{address:"8.8.8.8",family:4}],
    createSmtpClient(){return {verify:async()=>{throw Object.assign(new Error("PRIVATE_SMTP_ERROR"),{code:"EAUTH",command:"AUTH LOGIN",responseCode:535});},sendMail:async()=>{throw new Error("No send expected");},close(){}};}
  });
  assert.ok(rejectedTransport);
  assert.deepEqual(await rejectedTransport.authorize({}),{allowed:false,reason:"MAIL_SMTP_CREDENTIALS_REJECTED"});
  const paused=(await test.call("/api/mail-profile")).body.profile;
  assert.equal(paused.status,"disabled","Permanent authentication failure must stop subsequent worker cycles");
  assert.equal(paused.version,beforeFailure.version+1);
  assert.equal(await resolveWorkMailTransport(test.pool,Buffer.from(encryptionKeyHex,"hex"),"development","profile"),null);
  const failureAudit=await test.pool.query("SELECT meta FROM audit_events WHERE action='mail_profile_connection_rejected' AND target=$1",[paused.profileId]);
  assert.equal(failureAudit.rows.length,1);
  assert.equal(failureAudit.rows[0].meta.reason,"MAIL_SMTP_CREDENTIALS_REJECTED");
  assert.ok(!JSON.stringify(failureAudit.rows).includes("PRIVATE_SMTP_ERROR"));
  const fixedProposal=await test.call("/api/mail-profile/activation-proposals",{});
  assert.equal((await test.call(`/api/approvals/${fixedProposal.body.approvalId}/approve`,{})).status,200);
  assert.equal((await rejectedTransport.authorize({})).reason,"MAIL_PROFILE_CHANGED");
  assert.equal((await test.call("/api/mail-profile")).body.profile.status,"active","An old transport cannot disable a newly approved version");
  console.log(
    JSON.stringify({
      scenario: "mail-profile",
      result: "PASS",
      database: test.database,
      runId: test.runId,
      assertions: [
        "write-only-mask",
        "encrypted-not-plaintext",
        "update-invalidates",
        "old-approval-stale",
        "current-explicit-activation",
        "disable",
        "wrong-origin",
        "private-host-rejected",
        "forged-payload",
      ],
      externalNetworkCalls: 0,
    }),
  );
} finally {
  await test.close();
}
