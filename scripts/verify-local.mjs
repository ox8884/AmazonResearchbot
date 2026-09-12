import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario")+1] : "csv20";

function runTs(file, args = [], tsconfig) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", file, ...args], { cwd: root, stdio: "inherit", shell: false, env: { ...process.env, AI_TRANSPORT:"disabled",JS_TRANSPORT:"disabled",MAIL_TRANSPORT:"disabled", ...(tsconfig ? { TSX_TSCONFIG_PATH: path.join(root, tsconfig) } : {}) } });
    child.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${file} exited ${code}`));
    });
  });
}

if (scenario === "all") {
  console.error("Full acceptance suite remains intentionally gated: run named local scenarios; R5/R6 user and external acceptance are not included.");
  await runTs("scripts/verify-unattended-ui.mjs");
  await runTs("scripts/verify-contrast.mjs");
  await runTs("scripts/verify-order-api.mjs");
  process.exit(2);
}
if (scenario === "saved-searches") {
  await runTs("scripts/verify-saved-searches.mjs");
  process.exit(0);
}
if (scenario === "inbox") {
  await runTs("scripts/verify-inbox-content.mjs");
  await runTs("scripts/verify-inbox-connector.mjs");
  await runTs("scripts/verify-inbox-wire.mjs");
  await runTs("scripts/verify-inbox-store.mjs");
  await runTs("scripts/verify-inbox-loop.mjs");
  await runTs("scripts/verify-inbox-api.mjs");
  await runTs("scripts/verify-mail-quote-extraction.ts");
  await runTs("scripts/verify-mail-quotes.mjs");
  await runTs("scripts/verify-quote-flow.mjs");
  await runTs("scripts/verify-quote-prefill.mjs", [], "apps/web/tsconfig.json");
  await runTs("scripts/verify-reply-provenance.mjs", [], "apps/web/tsconfig.json");
  process.exit(0);
}
if (scenario === "mail") {
  await runTs("scripts/verify-mail-connectors.mjs");
  await runTs("scripts/verify-mail-profile.mjs");
  await runTs("scripts/verify-mail-ui.mjs", [], "apps/web/tsconfig.json");
  process.exit(0);
}
if (scenario === "api-validation") {
  await runTs("scripts/verify-api-source-capture.mjs");
  await runTs("scripts/verify-api-supplementary.mjs");
  await runTs("scripts/verify-api-validation.mjs");
  await runTs("scripts/verify-market-leader.mjs");
  await runTs("scripts/verify-market-leader-flow.mjs");
  await runTs("scripts/verify-first-page-sales.mjs");
  await runTs("scripts/verify-dev-browser-client.mjs");
  await runTs("scripts/verify-candidate-view.mjs");
  await runTs("scripts/verify-worker-replay.mjs");
  process.exit(0);
}
if (scenario === "js-transport") {
  await runTs("scripts/verify-js-contracts.ts");
  await runTs("scripts/verify-simulator-boundary.mjs");
  await runTs("scripts/verify-pinned-http.mjs");
  process.exit(0);
}
if (scenario === "subscriptions") {
  await runTs("scripts/verify-subscriptions.mjs");
  process.exit(0);
}
if (scenario === "approvals") {
  await runTs("scripts/verify-settings-approvals.mjs");
  await runTs("scripts/verify-contact.mjs");
  await runTs("scripts/verify-contact-recovery.mjs");
  await runTs("scripts/verify-contact-persistence.mjs");
  process.exit(0);
}
if (scenario === "orders") {
  await runTs("scripts/verify-orders.mjs", ["--acceptance"]);
  await runTs("scripts/verify-order-api.mjs");
  process.exit(0);
}
if (scenario === "daily-backup") {
  await runTs("scripts/verify-daily-backup.mjs");
  process.exit(0);
}
if (scenario === "backup") {
  const target = process.argv.includes("--target") ? process.argv[process.argv.indexOf("--target") + 1] : "isolated";
  if (target !== "isolated") throw new Error("Restore verification only supports isolated targets");
  await runTs("scripts/verify-backup.mjs");
  await runTs("scripts/verify-backup-cli.mjs");
  process.exit(0);
}
if (scenario === "planner") {
  await runTs("scripts/verify-schedule.ts");
  await runTs("scripts/verify-daily-planner.mjs");
  await runTs("scripts/verify-planner-live.mjs");
  process.exit(0);
}
if (scenario === "auth") {
  await runTs("scripts/verify-recovery-storage.mjs");
  await runTs("scripts/verify-recovery-auth.mjs");
  await runTs("scripts/verify-trusted-devices.mjs");
  await runTs("scripts/verify-session-management.mjs");
  await runTs("scripts/verify-auth-throttle.mjs");
  await runTs("scripts/verify-auth-route.mjs");
  await runTs("scripts/verify-api-errors.mjs");
  process.exit(0);
}
if (scenario === "reimport") {
  await runTs("scripts/verify-reimport.mjs");
  process.exit(0);
}
if (scenario === "settings") {
  await runTs("scripts/verify-settings.ts");
  process.exit(0);
}
if (scenario === "economics") {
  await runTs("scripts/verify-economics.ts");
  process.exit(0);
}
if (scenario === "sourcing") {
  await runTs("scripts/verify-sourcing.mjs");
  process.exit(0);
}
if (scenario === "evidence") {
  await runTs("scripts/verify-evidence.ts");
  process.exit(0);
}
if (scenario === "budget") {
  await runTs("scripts/verify-budget.ts");
  process.exit(0);
}
if (scenario === "csv20") {
  await runTs("scripts/verify-csv20.mjs");
  process.exit(0);
}
if (scenario === "unattended") {
  await runTs("scripts/verify-unattended-flow.mjs");
  process.exit(0);
}
if (scenario === "unattended-ui") {
  await runTs("scripts/verify-unattended-ui.mjs");
  process.exit(0);
}
if (scenario === "contrast") {
  await runTs("scripts/verify-contrast.mjs");
  process.exit(0);
}
if (scenario === "integrated") {
  await runTs("scripts/verify-unattended-flow.mjs");
  await runTs("scripts/verify-unattended-ui.mjs");
  await runTs("scripts/verify-contrast.mjs");
  await runTs("scripts/verify-orders.mjs", ["--acceptance"]);
  await runTs("scripts/verify-order-api.mjs");
  process.exit(0);
}
if (scenario === "providers") {
  await runTs("scripts/verify-custom-ai-settings.mjs");
  await runTs("scripts/verify-ai-transport.mjs");
  await runTs("scripts/verify-ai-execution.mjs");
  await runTs("scripts/verify-ai-business-contract.mjs");
  await runTs("scripts/verify-ai-business.mjs");
  await runTs("scripts/verify-ai-rfq.mjs");
  await runTs("scripts/verify-subscriptions.mjs");
  process.exit(0);
}
if (scenario === "security") {
  await runTs("scripts/verify-secrets.ts");
  await runTs("scripts/verify-egress.ts");
  await runTs("scripts/verify-dns-boundary.ts");
  await runTs("scripts/verify-pinned-http.mjs");
  await runTs("scripts/verify-recovery-storage.mjs");
  await runTs("scripts/verify-recovery-auth.mjs");
  await runTs("scripts/verify-trusted-devices.mjs");
  await runTs("scripts/verify-session-management.mjs");
  await runTs("scripts/verify-auth-throttle.mjs");
  await runTs("scripts/verify-auth-route.mjs");
  await runTs("scripts/verify-api-errors.mjs");
  await runTs("scripts/verify-settings-approvals.mjs");
  await runTs("scripts/verify-inbox-content.mjs");
  await runTs("scripts/verify-ai-business-contract.mjs");
  process.exit(0);
}
if (scenario === "summary-delivery") {
  await runTs("scripts/verify-summary-delivery.mjs");
  process.exit(0);
}

console.error(`Unknown or not-yet-implemented local scenario: ${scenario}`);
process.exit(2);
