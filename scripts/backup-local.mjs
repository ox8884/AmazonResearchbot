import {configuredBackupRecovery} from "./support/browser-signing-recovery.mjs";
import { backupLocations } from "./support/backup-locations.mjs";
import { readFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseKey } from "../packages/security/src/secrets.ts";
import {
  createLocalBackup,
  restoreLocalBackup,
} from "./support/local-backup.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "key-file": { type: "string" },
      output: { type: "string" },
      "escrow-dir": { type: "string" },
      archive: { type: "string" },
      escrow: { type: "string" },
      target: { type: "string" },
    },
  });
  const mode = positionals[0];
  if (
    positionals.length !== 1 ||
    !["backup", "restore"].includes(mode) ||
    !values["key-file"]
  )
    throw new Error("arguments");
  const env = {
    ...parseEnv(await readFile(resolve(root, ".env"), "utf8")),
    ...process.env,
  };
  if (env.APP_ENV !== "development") throw new Error("development-only");
  const keyFile = resolve(values["key-file"]),
    backupKey = parseKey(await readFile(keyFile, "utf8"));
  if (mode === "backup") {
    if (!values["escrow-dir"]) throw new Error("escrow-required");
    const { outputDirectory, escrowDirectory } = backupLocations(root, {
      keyFile,
      outputDirectory: values.output ?? "data/backups",
      escrowDirectory: values["escrow-dir"],
    });
    const result = await createLocalBackup({
      databaseUrl: env.DATABASE_URL,
      backupKey,
      outputDirectory,
      escrowDirectory,
      recovery: await configuredBackupRecovery(env),
    });
    console.log(
      JSON.stringify({
        status: "encrypted-local-backup-created",
        ...result,
        uploaded: false,
      }),
    );
  } else {
    if (values.target !== "isolated" || !values.archive || !values.escrow)
      throw new Error("isolated-restore-arguments");
    const result = await restoreLocalBackup({
      archive: resolve(values.archive),
      escrow: resolve(values.escrow),
      backupKey,
      adminUrl: env.DATABASE_URL,
    });
    console.log(
      JSON.stringify({
        status: "restored-and-verified",
        database: new URL(result.databaseUrl).pathname.slice(1),
        tables: result.tableCount,
        worker: "quarantined",
        externalCalls: 0,
      }),
    );
  }
} catch {
  console.error(
    "로컬 백업/복원 실패. development 환경, 별도로 보관한 64자리 hex 키 파일, 경로와 파일 무결성을 확인하세요. 기존 DB를 덮어쓰지 않습니다.",
  );
  console.error(
    "backup --key-file <file> --output <directory> --escrow-dir <separate-directory>",
  );
  console.error(
    "restore --target isolated --key-file <file> --archive <file> --escrow <file>",
  );
  process.exitCode = 1;
}
