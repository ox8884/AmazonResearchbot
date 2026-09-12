import { matchesSentMessage, receivedExactlyOne } from "../packages/integrations/src/mail/receipt.ts";
import { createTransport } from "../packages/integrations/node_modules/nodemailer/dist/esm/nodemailer.js";
import assert from "node:assert/strict";
import { createSmtpImapTransport } from "../packages/integrations/src/mail/smtp.ts";

const actionId = "2d879e87-7512-4d76-9a6d-22a2f5038e0f";
const payload = Object.freeze({
  payloadVersion: 1,
  rfqId: "d55e83e0-b803-4825-934d-105ffbe8f808",
  candidateId: "29deba8a-cde7-43f1-a6ca-d5b76a6d8230",
  supplierId: "aaf0f435-4735-456c-8ff2-b159887c3dcf",
  specId: "376755b2-9b77-4919-b678-bc5ca40a42a6",
  revision: 1,
  recipient: "supplier@example.net",
  subject: "RFQ: exact matching test",
  body: "Plain request body",
  quantity: 300,
  settingsVersion: 1,
  channel: "email",
});

function grant(overrides = {}) {
  return {
    id: "5b081e04-c67f-4b51-ac0b-3e5882d8222f",
    version: 7,
    secretVersion: 3,
    config: {
      name: "QA mail profile",
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      imapHost: "imap.example.com",
      imapPort: 993,
      sender: "buyer@example.com",
      username: "buyer@example.com",
      sentMailbox: "Sent",
      inboxMailbox: "INBOX",
    },
    ...overrides,
  };
}

function smtpInfo(messageId) {
  return {
    accepted: [payload.recipient],
    rejected: [],
    messageId,
    envelope: { from: "buyer@example.com", to: [payload.recipient] },
  };
}

function baseDependencies({
  resolver = async () => [{ address: "8.8.8.8", family: 4 }],
  createSmtpClient,
  createImapClient,
} = {}) {
  return {
    resolveHost: resolver,
    ...(createSmtpClient ? { createSmtpClient } : {}),
    ...(createImapClient ? { createImapClient } : {}),
  };
}

async function verifyTlsPinning() {
  const smtpOptions = [];
  let verifyCalls = 0;
  const transport = createSmtpImapTransport(
    grant(),
    { isCurrent: async () => true, readPassword: async () => "not-logged" },
    baseDependencies({
      createSmtpClient(options) {
        smtpOptions.push(options);
        return {
          verify: async () => {
            verifyCalls += 1;
            return true;
          },
          sendMail: async (message) => smtpInfo(message.messageId),
          close() {},
        };
      },
    }),
  );
  assert.deepEqual(await transport.authorize(payload), { allowed: true });
  assert.equal(verifyCalls, 1);
  const secureOptions = smtpOptions[0];
  assert.equal(secureOptions.host, "8.8.8.8");
  assert.equal(secureOptions.port, 465);
  assert.equal(secureOptions.secure, true);
  assert.equal(secureOptions.requireTLS, false);
  assert.equal(secureOptions.tls.servername, "smtp.example.com");
  assert.equal(secureOptions.tls.rejectUnauthorized, true);
  assert.equal(
    secureOptions.tls.checkServerIdentity("ignored.example", {
      subjectaltname: "DNS:smtp.example.com",
    }),
    undefined,
  );
  assert.ok(
    secureOptions.tls.checkServerIdentity("smtp.example.com", {
      subjectaltname: "DNS:other.example.com",
    }) instanceof Error,
  );

  const startTlsOptions = [];
  const startTls = createSmtpImapTransport(
    grant({ config: { ...grant().config, smtpPort: 587 } }),
    { isCurrent: async () => true, readPassword: async () => "not-logged" },
    baseDependencies({
      createSmtpClient(options) {
        startTlsOptions.push(options);
        return { verify: async () => true, sendMail: async () => smtpInfo("unused"), close() {} };
      },
    }),
  );
  assert.deepEqual(await startTls.authorize(payload), { allowed: true });
  assert.equal(startTlsOptions[0].secure, false);
  assert.equal(startTlsOptions[0].requireTLS, true);
}

async function verifyDeniedBeforeSecretLookup() {
  let secretReads = 0;
  let clientCreates = 0;
  const transport = createSmtpImapTransport(
    grant(),
    {
      isCurrent: async () => true,
      readPassword: async () => {
        secretReads += 1;
        return "mail-password-that-must-not-be-read";
      },
    },
    baseDependencies({
      resolver: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      createSmtpClient() {
        clientCreates += 1;
        throw new Error("must not create SMTP client");
      },
    }),
  );
  assert.deepEqual(await transport.authorize(payload), {
    allowed: false,
    reason: "MAIL_SMTP_TARGET_DENIED",
  });
  assert.equal(secretReads, 0);
  assert.equal(clientCreates, 0);
}

async function verifyInactiveAndChangedProfilesDoNotSend() {
  let inactiveSecretReads = 0;
  let inactiveSends = 0;
  const inactive = createSmtpImapTransport(
    grant(),
    {
      isCurrent: async () => false,
      readPassword: async () => {
        inactiveSecretReads += 1;
        return "must-not-read";
      },
    },
    baseDependencies({
      createSmtpClient() {
        return {
          verify: async () => true,
          sendMail: async () => {
            inactiveSends += 1;
            return smtpInfo("unused");
          },
          close() {},
        };
      },
    }),
  );
  assert.deepEqual(await inactive.authorize(payload), {
    allowed: false,
    reason: "MAIL_PROFILE_CHANGED",
  });
  assert.deepEqual(await inactive.send(payload, actionId), {
    kind: "not_sent",
    reason: "MAIL_PROFILE_CHANGED",
  });
  assert.equal(inactiveSecretReads, 0);
  assert.equal(inactiveSends, 0);

  const states = [true, true, true, true, false];
  let changedSends = 0;
  const changed = createSmtpImapTransport(
    grant(),
    {
      isCurrent: async () => states.shift() ?? false,
      readPassword: async () => "mail-password-not-logged",
    },
    baseDependencies({
      createSmtpClient() {
        return {
          verify: async () => true,
          sendMail: async () => {
            changedSends += 1;
            return smtpInfo("unused");
          },
          close() {},
        };
      },
    }),
  );
  assert.deepEqual(await changed.authorize(payload), { allowed: true });
  assert.deepEqual(await changed.send(payload, actionId), {
    kind: "not_sent",
    reason: "MAIL_PROFILE_CHANGED",
  });
  assert.equal(changedSends, 0);
}

async function verifyTextOnlyAndSafeOutcomes() {
  const sentMessages = [];
  const literalPayload = { ...payload, body: "<b>literal text, not HTML</b>" };
  const transport = createSmtpImapTransport(
    grant(),
    { isCurrent: async () => true, readPassword: async () => "not-logged" },
    baseDependencies({
      createSmtpClient() {
        return {
          verify: async () => true,
          sendMail: async (message) => {
            sentMessages.push(message);
            return smtpInfo(message.messageId);
          },
          close() {},
        };
      },
    }),
  );
  assert.deepEqual(await transport.authorize(literalPayload), { allowed: true });
  const result = await transport.send(literalPayload, actionId);
  assert.equal(result.kind, "sent");
  const message = sentMessages[0];
  assert.equal(message.text, literalPayload.body);
  assert.equal(Object.hasOwn(message, "html"), false);
  assert.equal(message.textEncoding, "base64");
  assert.equal(message.disableFileAccess, true);
  assert.equal(message.disableUrlAccess, true);

  const unsafeText = "super-secret-password <private body>";
  let mismatchSendAttempts = 0;
  const mismatch = createSmtpImapTransport(
    grant(),
    { isCurrent: async () => true, readPassword: async () => unsafeText },
    baseDependencies({
      createSmtpClient() {
        return {
          verify: async () => true,
          sendMail: async () => {
            mismatchSendAttempts += 1;
            return { ...smtpInfo("<different@example.com>") };
          },
          close() {},
        };
      },
    }),
  );
  assert.deepEqual(await mismatch.authorize(payload), { allowed: true });
  const mismatchResult = await mismatch.send(payload, actionId);
  assert.deepEqual(mismatchResult, { kind: "unknown", reason: "SMTP_RECEIPT_UNCONFIRMED" });
  assert.equal(mismatchSendAttempts, 1);
  assert.equal(JSON.stringify(mismatchResult).includes(unsafeText), false);
  assert.equal(JSON.stringify(mismatchResult).includes(literalPayload.body), false);

  let networkSendAttempts = 0;
  const networkFailure = createSmtpImapTransport(
    grant(),
    { isCurrent: async () => true, readPassword: async () => unsafeText },
    baseDependencies({
      createSmtpClient() {
        return {
          verify: async () => true,
          sendMail: async () => {
            networkSendAttempts += 1;
            throw new Error(unsafeText);
          },
          close() {},
        };
      },
    }),
  );
  assert.deepEqual(await networkFailure.authorize(payload), { allowed: true });
  const networkResult = await networkFailure.send(payload, actionId);
  assert.deepEqual(networkResult, { kind: "unknown", reason: "SMTP_OUTCOME_UNKNOWN" });
  assert.equal(networkSendAttempts, 1);
  assert.equal(JSON.stringify(networkResult).includes(unsafeText), false);
}

function textOnlySource(messageId, body) {
  return Buffer.from(
    [
      `Message-ID: ${messageId}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body, "utf8").toString("base64"),
      "",
    ].join("\r\n"),
    "utf8",
  );
}

async function verifyReadOnlyExactSentReconciliation() {
  const expectedMessageId = `<forge-rfq-${actionId}@example.com>`;
  let smtpClientCreates = 0;
  let searchMessageId = null;
  let mailbox = null;
  let lockReleased = 0;
  const imapOptions = [];
  const transport = createSmtpImapTransport(
    grant(),
    { isCurrent: async () => true, readPassword: async () => "not-logged" },
    baseDependencies({
      createSmtpClient() {
        smtpClientCreates += 1;
        throw new Error("reconciliation must not create SMTP");
      },
      createImapClient(options) {
        imapOptions.push(options);
        return {
          connect: async () => {},
          logout: async () => {},
          getMailboxLock: async (path, options) => {
            mailbox = { path, options };
            return { release: () => { lockReleased += 1; } };
          },
          searchExactMessageId: async (messageId) => {
            searchMessageId = messageId;
            return [42];
          },
          fetchSentMessage: async () => ({
            from: ["buyer@example.com"],
            to: [payload.recipient],
            subject: payload.subject,
            source: textOnlySource(expectedMessageId, `${payload.body}\r\n`),
          }),
        };
      },
    }),
  );
  const receipt = await transport.reconcile(payload, actionId);
  assert.equal(searchMessageId, expectedMessageId);
  assert.deepEqual(mailbox, { path: "Sent", options: { readOnly: true } });
  assert.equal(lockReleased, 1);
  assert.equal(smtpClientCreates, 0);
  assert.equal(imapOptions[0].host, "8.8.8.8");
  assert.equal(imapOptions[0].port, 993);
  assert.equal(imapOptions[0].secure, true);
  assert.equal(imapOptions[0].servername, "imap.example.com");
  assert.equal(imapOptions[0].tls.servername, "imap.example.com");
  assert.equal(imapOptions[0].tls.rejectUnauthorized, true);
  assert.ok(imapOptions[0].maxLiteralSize <= 256*1024+1);
  assert.ok(imapOptions[0].maxResponseSize <= 320*1024);
  assert.equal(imapOptions[0].logRaw, false);
  assert.equal(imapOptions[0].emitLogs, false);
  assert.deepEqual(receipt, {
    kind: "sent",
    messageId: expectedMessageId,
    receipt: JSON.stringify({
      transport: "smtp-imap",
      messageId: expectedMessageId,
      reconciled: true,
    }),
  });

  const mismatch = createSmtpImapTransport(
    grant(),
    { isCurrent: async () => true, readPassword: async () => "not-logged" },
    baseDependencies({
      createImapClient() {
        return {
          connect: async () => {},
          logout: async () => {},
          getMailboxLock: async () => ({ release() {} }),
          searchExactMessageId: async () => [42],
          fetchSentMessage: async () => ({
            from: ["buyer@example.com"],
            to: [payload.recipient],
            subject: "mismatched subject",
            source: textOnlySource(expectedMessageId, payload.body),
          }),
        };
      },
    }),
  );
  assert.equal(await mismatch.reconcile(payload, actionId), null);
}

async function verifyReceiptBoundary() {
  const messageId=`<forge-rfq-${actionId}@example.com>`;
  const message={from:["buyer@example.com"],to:[payload.recipient],subject:payload.subject,source:textOnlySource(messageId,payload.body)};
  assert.equal(matchesSentMessage({...message,to:[payload.recipient.toUpperCase()]},payload,"buyer@example.com",messageId),false,"Different local-part case is not proof of the approved recipient");
  assert.equal(receivedExactlyOne({...smtpInfo(messageId),accepted:["different@example.net"]},messageId,payload.recipient),false,"SMTP accepted recipient must match the approval");
  assert.equal(matchesSentMessage({...message,source:Buffer.concat([message.source,Buffer.alloc(300*1024,32)])},payload,"buyer@example.com",messageId),false,"Oversized raw sources cannot be accepted");
  const unicode={...payload,subject:"견적 · 수신 확인",body:`첫 줄 <b>문자 그대로</b>
둘째 줄`};
  const offline=createTransport({streamTransport:true,buffer:true,newline:"windows"});
  try {
    const generated=await offline.sendMail({from:"buyer@example.com",to:unicode.recipient,subject:unicode.subject,text:unicode.body,textEncoding:"base64",messageId});
    assert.ok(Buffer.isBuffer(generated.message));
    assert.equal(matchesSentMessage({from:["buyer@example.com"],to:[unicode.recipient],subject:unicode.subject,source:generated.message},unicode,"buyer@example.com",messageId),true,"Real offline Nodemailer MIME must reconcile exactly");
  } finally {offline.close();}
}

async function verifyPermanentRejections() {
  let active=true,paused=0;
  const credentials=createSmtpImapTransport(grant(),{isCurrent:async()=>active,readPassword:async()=>"private-fixture",pauseProfile:async()=>{paused++;active=false;return true;}},baseDependencies({createSmtpClient(){return {verify:async()=>{throw Object.assign(new Error("PRIVATE_ERROR_BODY"),{code:"EAUTH",command:"AUTH LOGIN",responseCode:535});},sendMail:async()=>{throw new Error("No send expected");},close(){}};}}));
  const denied=await credentials.authorize(payload);
  assert.equal(denied.allowed,false);assert.equal(paused,1,"Permanent authentication rejection pauses the profile instead of retrying credentials");
  const recipient=createSmtpImapTransport(grant(),{isCurrent:async()=>true,readPassword:async()=>"fixture",pauseProfile:async()=>{throw new Error("Recipient rejection must not disable the account");}},baseDependencies({createSmtpClient(){return {verify:async()=>true,sendMail:async()=>{throw Object.assign(new Error("PRIVATE_RECIPIENT_ERROR"),{code:"EENVELOPE",command:"RCPT TO",responseCode:550});},close(){}};}}));
  const unsent=await recipient.send(payload,actionId);
  assert.deepEqual(unsent,{kind:"not_sent",reason:"MAIL_SMTP_RECIPIENT_REJECTED"});
  let senderPaused=0;
  const sender=createSmtpImapTransport(grant(),{isCurrent:async()=>true,readPassword:async()=>"fixture",pauseProfile:async(_grant,reason)=>{assert.equal(reason,"MAIL_SMTP_SENDER_REJECTED");senderPaused++;return true;}},baseDependencies({createSmtpClient(){return {verify:async()=>true,sendMail:async()=>{throw Object.assign(new Error("PRIVATE_SENDER_ERROR"),{code:"EENVELOPE",command:"MAIL FROM",responseCode:550});},close(){}};}}));
  assert.deepEqual(await sender.send(payload,actionId),{kind:"not_sent",reason:"MAIL_SMTP_SENDER_REJECTED"});
  assert.equal(senderPaused,1);
  for(const failure of [{code:"EENVELOPE",command:"DATA",responseCode:550},{code:"ESOCKET",command:"CONN",responseCode:550}]){
    const ambiguous=createSmtpImapTransport(grant(),{isCurrent:async()=>true,readPassword:async()=>"fixture",pauseProfile:async()=>{throw new Error("Ambiguous delivery must not pause as confirmed unsent");}},baseDependencies({createSmtpClient(){return {verify:async()=>true,sendMail:async()=>{throw Object.assign(new Error("PRIVATE_ERROR"),failure);},close(){}};}}));
    assert.deepEqual(await ambiguous.send(payload,actionId),{kind:"unknown",reason:"SMTP_OUTCOME_UNKNOWN"});
  }

}
await verifyPermanentRejections();
await verifyReceiptBoundary();
await verifyTlsPinning();
await verifyDeniedBeforeSecretLookup();
await verifyInactiveAndChangedProfilesDoNotSend();
await verifyTextOnlyAndSafeOutcomes();
await verifyReadOnlyExactSentReconciliation();
console.log(JSON.stringify({
  scenario: "mail-connectors",
  result: "PASS",
  externalConnections: 0,
  smtpResends: 0,
  verified: [
    "SMTP pinned IP with original-host TLS SNI and certificate identity",
    "private or mixed DNS denied before password lookup",
    "inactive or changed profile sends zero messages",
    "text-only payload and safe ambiguous result",
    "read-only IMAP exact Message-ID reconciliation without SMTP",
  ],
}));
