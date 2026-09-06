import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, migrate, seedInitialSettings } from "@forge-ops/db";
import { PgBoss } from "pg-boss";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const envText = await readFile(path.join(root, ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (process.env[k] == null) process.env[k] = v;
  }
} catch {
  /* .env optional when env already set */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}

const pool = createPool(url);
const applied = await migrate(pool);
await seedInitialSettings(pool);
const boss = new PgBoss({ connectionString: url, migrate: true, supervise: false, schedule: false });
await boss.start();
await boss.createQueue("candidate.advance");
await boss.stop({ graceful: false, timeout: 2000 });
await pool.end();
console.log(`migrations: ${applied.join(", ") || "none"}`);
