import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function exists(bin) {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of paths) {
    try {
      await access(path.join(dir, bin));
      return true;
    } catch {
      try {
        await access(path.join(dir, `${bin}.exe`));
        return true;
      } catch {
        /* continue */
      }
    }
  }
  return false;
}

if (!(await exists("node"))) fail("Node.js 24가 필요합니다. https://nodejs.org 에서 LTS를 설치해 주세요.");
if (!(await exists("docker"))) {
  fail("Docker Desktop이 없습니다. 설치한 뒤 실행해 주세요. 이 명령은 시스템 패키지를 설치하지 않습니다.");
}

try {
  await access(path.join(root, ".env"));
} catch {
  const secret = randomBytes(32).toString("hex");
  const key = randomBytes(32).toString("hex");
  const password = `dev-${randomBytes(6).toString("hex")}`;
  await writeFile(
    path.join(root, ".env"),
    [
      "APP_ENV=development",
      "DATABASE_URL=postgres://forge:forge@127.0.0.1:5433/forge_ops",
      "WEB_ORIGIN=http://localhost:5173",
      "API_PORT=3001",
      `BETTER_AUTH_SECRET=${secret}`,
      `ENCRYPTION_KEY=${key}`,
      "DATA_DIR=./data",
      "BOOTSTRAP_EMAIL=jay@local.test",
      `BOOTSTRAP_PASSWORD=${password}`,
      "JS_DAILY_WIRE_CAP=0",
      "",
    ].join("\n"),
  );
  console.log("로컬 .env를 만들었습니다. 비밀번호는 그 파일에만 있습니다.");
}

const envText = await (await import("node:fs/promises")).readFile(path.join(root, ".env"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (process.env[k] == null) process.env[k] = v;
}

const compose = spawn("docker", ["compose", "-p", "forgeops", "up", "-d"], { stdio: "inherit", cwd: root, shell: true });
await wait(compose);
if (compose.exitCode !== 0) fail("Docker Desktop이 실행 중인지 확인해 주세요. 데이터베이스 볼륨은 지우지 않았습니다.");

for (let i = 0; i < 40; i++) {
  const ping = spawn("docker", ["compose", "-p", "forgeops", "exec", "-T", "postgres", "pg_isready", "-U", "forge", "-d", "forge_ops"], {
    cwd: root,
    shell: true,
    stdio: "ignore",
  });
  const code = await wait(ping);
  if (code === 0) break;
  if (i === 39) fail("Postgres가 아직 준비되지 않았습니다.");
  await delay(500);
}


const migrate = spawn("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
  stdio: "inherit",
  cwd: root,
  shell: true,
  env: process.env,
});
await wait(migrate);
if (migrate.exitCode !== 0) fail("데이터베이스 준비에 실패했습니다.");
const children = [
  spawn("pnpm", ["--filter", "@forge-ops/api", "start"], { stdio: "inherit", cwd: root, shell: true, env: process.env }),
  spawn("pnpm", ["--filter", "@forge-ops/worker", "start"], { stdio: "inherit", cwd: root, shell: true, env: process.env }),
  spawn("pnpm", ["--filter", "@forge-ops/web", "dev"], { stdio: "inherit", cwd: root, shell: true, env: process.env }),
];

console.log("웹 http://localhost:5173  API http://localhost:3001  Mailpit http://localhost:8025");

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.race(children.map((c) => wait(c)));
shutdown();

function wait(child) {
  return new Promise((resolve) => child.on("close", resolve));
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
