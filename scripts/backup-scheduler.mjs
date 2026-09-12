import {configuredBackupRecovery} from "./support/browser-signing-recovery.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, parseArgs } from "node:util";
import { runDailyBackup } from "./support/daily-backup.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
try {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: { once: { type: "boolean", default: false } },
  });
  const env = {
    ...parseEnv(await readFile(resolve(root, ".env"), "utf8")),
    ...process.env,
  };
  if (env.APP_ENV !== "development")
    throw new Error("Development scheduler only");
  const options = {
    databaseUrl: env.DATABASE_URL,
    keyFile:
      env.LOCAL_BACKUP_KEY_FILE ?? "data/recovery-keys/local-backup-v1.key",
    outputDirectory: env.LOCAL_BACKUP_DIRECTORY ?? "data/backups",
    escrowDirectory:
      env.LOCAL_BACKUP_ESCROW_DIRECTORY ?? "data/recovery-escrow",
    recovery: await configuredBackupRecovery(env),
  };
  if (values.once) {
    console.log(JSON.stringify(await runDailyBackup(options)));
  } else {
    let active = null,
      lastState;
    function tick() {
      if (active) return;
      active = runDailyBackup(options)
        .then((result) => {
          const state = ["created", "existing"].includes(result.kind)
            ? "ready"
            : result.kind;
          if (result.kind === "created" || lastState !== state)
            console.log(
              JSON.stringify({
                service: "local-backup",
                kind: result.kind,
                day: result.day,
                id: result.id,
              }),
            );
          lastState = state;
        })
        .catch(() => {
          if (lastState !== "failed")
            console.error(
              "일일 로컬 백업 완료를 확인하지 못했습니다. 다음 주기에 완료 기록과 파일을 다시 확인합니다.",
            );
          lastState = "failed";
        })
        .finally(() => {
          active = null;
        });
    }
    const timer = setInterval(tick, 60000);
    tick();
    const shutdown = async () => {
      clearInterval(timer);
      await active;
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }
} catch {
  console.error(
    "로컬 백업 스케줄러를 시작하지 못했습니다. development 환경과 백업 설정을 확인하세요.",
  );
  process.exitCode = 1;
}
