import { recoverProposedSpecs } from "./automatic-spec.ts";
import { loadBrowserSigningKey, publishBrowserSigningIdentity } from "./browser-signing-key.ts";
import { dispatchBrowserWork } from "./browser-dispatch.ts";
import { readRuntimeAuthority, runtimeEnvironment, assertDatabaseAuthority } from "@forge-ops/security";
import { runSummaryDeliveryCycle } from "./summary-delivery-loop.ts";
import { prepareReadyRfqs } from "./automatic-rfq.ts";
import { createAiTransport } from "@forge-ops/integrations/ai/transport";
import { runDailyPlanner } from "./planner.ts";
import { recordInboxQuotes } from "./inbox-quote-loop.ts";
import { createInboxCycle } from "./inbox-loop.ts";
import { advanceCandidate, type AdvanceJob } from "./advance-candidate.ts";
import { createContactCycle } from "./contact-loop.ts";
import { resolveWorkMailTransport } from "./work-mail.ts";
import { parseKey } from "@forge-ops/security";
import { recoverContactOutcomes } from "./contact-runner.ts";
import { createPool, recoverDispatchingAttempts } from "@forge-ops/db";
import { resolveTransport } from "@forge-ops/integrations/jungle-scout/transport";
import { PgBoss, type Job } from "pg-boss";
const JOB_ADVANCE = "candidate.advance";



const runtimeAuthority=await readRuntimeAuthority("worker",process.env);
const source=await runtimeEnvironment(runtimeAuthority,process.env);
const appEnv=runtimeAuthority.appEnv;
const databaseUrl=runtimeAuthority.databaseUrl;
const keyHex=source.ENCRYPTION_KEY;
if(!keyHex)throw new Error("ENCRYPTION_KEY missing");
const encryptionKey=parseKey(keyHex);
const browserPrivateKey=await loadBrowserSigningKey(source,appEnv);
const pool=createPool(databaseUrl);
try { await assertDatabaseAuthority(pool,runtimeAuthority); }
catch(error){await pool.end();throw error;}

const authorityConnection = await pool.connect();
const authority = await authorityConnection.query<{acquired:boolean}>("SELECT pg_try_advisory_lock(hashtext('forge_ops.worker_authority')) AS acquired");
if (!authority.rows[0]?.acquired) { authorityConnection.release(); await pool.end(); throw new Error("A worker already owns this database"); }

const browserSigning = await (async () => {
  if (!browserPrivateKey) return null;
  try {
    const origin = source.WEB_ORIGIN ?? "http://localhost:5173";
    const url = new URL(origin);
    const local = appEnv === "development" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || url.origin !== origin || url.username || url.password) throw new Error("INVALID_BROWSER_TASK_ORIGIN");
    const identity = await publishBrowserSigningIdentity(pool, browserPrivateKey);
    return { origin, privateKey: browserPrivateKey, fingerprint: identity.fingerprint };
  } catch (error) {
    authorityConnection.release();
    await pool.end();
    throw error;
  }
})();

const boss = new PgBoss({
  connectionString: databaseUrl,
  supervise: true,
  schedule: false,
  migrate: false,
});
await boss.start();
await recoverDispatchingAttempts(pool);
await recoverContactOutcomes(pool);
if(appEnv === "development")await boss.createQueue(JOB_ADVANCE);

await boss.work<AdvanceJob>(JOB_ADVANCE, { localConcurrency: 4, batchSize: 1 }, async (jobs: Job<AdvanceJob>[]) => {
  const job = jobs[0];
  if (!job) return;
  await advanceCandidate(pool, resolveTransport(source), job.data, {transport:createAiTransport(source.AI_TRANSPORT === "official"),encryptionKey});
});

let rfqTask: Promise<void> | null = null;
function prepareRfqWork(): void {
  if (rfqTask) return;
  rfqTask = recoverProposedSpecs(pool).then(() => prepareReadyRfqs(pool)).catch(() => {
    console.error("RFQ preparation interrupted; the next tick will retry");
  }).finally(() => { rfqTask = null; });
}
const rfqTimer = setInterval(prepareRfqWork, 5000);
prepareRfqWork();

const contactCycle = createContactCycle(pool, () => resolveWorkMailTransport(pool, encryptionKey, appEnv, source.MAIL_TRANSPORT));
let contactTask: Promise<void> | null = null;
const contactTimer = setInterval(() => {
  if (contactTask) return;
  contactTask = contactCycle().catch(() => { console.error("Contact processing interrupted; persisted state will be reconciled"); }).finally(() => { contactTask = null; });
}, 5000);

const inboxCycle = createInboxCycle(pool, encryptionKey, { mode: source.MAIL_TRANSPORT });
let inboxTask: Promise<void> | null = null;
function collectInbox(): void {
  if (inboxTask) return;
  inboxTask = inboxCycle().then(() => recordInboxQuotes(pool, encryptionKey)).then(() => undefined).catch(() => {
    console.error("Inbox collection interrupted; the saved cursor will be reused");
  }).finally(() => { inboxTask = null; });
}
const inboxTimer = setInterval(collectInbox, 60000);
collectInbox();

let summaryTask: Promise<void> | null = null;
function deliverSummaries(): void {
  if(summaryTask)return;
  summaryTask=runSummaryDeliveryCycle(pool,()=>resolveWorkMailTransport(pool,encryptionKey,appEnv,source.MAIL_TRANSPORT)).catch(()=>{
    console.error("Summary delivery interrupted; saved state will be reconciled");
  }).finally(()=>{summaryTask=null;});
}
const summaryTimer=setInterval(deliverSummaries,60000);
deliverSummaries();

let plannerTask: Promise<void> | null = null;
let plannerFailed = false;
function planDailyWork(): void {
  if (plannerTask) return;
  plannerTask = runDailyPlanner(pool,boss,{apiAvailable:resolveTransport(source).kind === "ready"}).then(result=>{
    if(result.created.length) console.log("Daily work prepared", {schedules:result.created,queued:result.queued});
    plannerFailed=false;
  }).catch(()=>{if(!plannerFailed)console.error("Daily planning interrupted; the next tick will retry");plannerFailed=true;}).finally(()=>{plannerTask=null;});
}
const plannerTimer=setInterval(planDailyWork,60000);
planDailyWork();

let browserTask: Promise<void> | null = null;
let browserFailed = false;
function dispatchBrowserTasks(): void {
  if (!browserSigning || browserTask) return;
  browserTask = dispatchBrowserWork(pool, browserSigning).then(result => {
    if (result.queued) console.log("Browser read tasks prepared", { queued: result.queued });
    browserFailed = false;
  }).catch(() => {
    if (!browserFailed) console.error("Browser dispatch interrupted; the next tick will retry");
    browserFailed = true;
  }).finally(() => { browserTask = null; });
}
const browserTimer = browserSigning ? setInterval(dispatchBrowserTasks, 5000) : null;
dispatchBrowserTasks();

console.log("worker listening for candidate.advance");

process.once("SIGTERM", async () => {
  if (browserTimer) clearInterval(browserTimer);
  clearInterval(contactTimer);
  clearInterval(rfqTimer);
  clearInterval(inboxTimer);
  clearInterval(plannerTimer);
  clearInterval(summaryTimer);
  const stopQueue = boss.stop({ graceful: true, timeout: 20000 });
  await Promise.all([stopQueue, contactTask, inboxTask, plannerTask, rfqTask, summaryTask, browserTask]);
  authorityConnection.release();
  await pool.end();
  process.exit(0);
});
