import { startOptionalBrowserClient } from "./support/dev-browser-client.mjs";
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

if (process.env.APP_ENV && process.env.APP_ENV !== "development") fail("LOCAL_DEVELOPMENT_ONLY: 로컬 실행기에서는 development만 사용할 수 있습니다.");
if (Number(process.versions.node.split(".")[0]) < 24) fail("Node.js 24 이상이 필요합니다.");

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
} catch (error) {
  if(!(error instanceof Error)||!("code" in error)||error.code!=="ENOENT")fail("환경 파일에 접근하지 못했습니다. 기존 파일은 변경하지 않습니다.");
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
    {flag:"wx",mode:0o600},
  );
  console.log("로컬 .env를 만들었습니다. 비밀번호는 그 파일에만 있습니다.");
}

const envText = await (await import("node:fs/promises")).readFile(path.join(root, ".env"), "utf8");
const fileEnv=(await import("node:util")).parseEnv(envText);
if(fileEnv.APP_ENV && fileEnv.APP_ENV !== "development")fail("LOCAL_DEVELOPMENT_ONLY: 프로덕션 환경 파일은 읽어 들이지 않습니다.");
for(const [name,value] of Object.entries(fileEnv))if(process.env[name]==null)process.env[name]=value;
try{
  const {validateDatabaseLocation}=await import("../packages/security/src/runtime-authority.ts");
  const databaseUrl=validateDatabaseLocation("development","worker",process.env.DATABASE_URL??"");
  const target=new URL(databaseUrl);
  if(target.pathname!=="/forge_ops"||target.port!=="5433")throw new Error("local compose target required");
}catch{fail("LOCAL_DEVELOPMENT_DATABASE_REQUIRED: 이 실행기는 로컬 forge_ops 개발 DB만 사용합니다.");}

const jsKeyFile = path.join(root, ".env.junglescout");
try {
  const contents = await (await import("node:fs/promises")).readFile(jsKeyFile, "utf8");
  const parsed = (await import("node:util")).parseEnv(contents);
  for (const name of ["JS_API_KEY_NAME", "JS_API_KEY"]) {
    if (process.env[name] == null && parsed[name]) process.env[name] = parsed[name];
  }
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

try {
  const contents = await (await import("node:fs/promises")).readFile(path.join(root, ".env.composio"), "utf8");
  const parsed = (await import("node:util")).parseEnv(contents);
  if (process.env.COMPOSIO_API_KEY == null && parsed.COMPOSIO_API_KEY) process.env.COMPOSIO_API_KEY = parsed.COMPOSIO_API_KEY;
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const compose = spawn("docker", ["compose", "-p", "forgeops", "up", "-d"], { windowsHide: true, detached: process.platform === "win32", stdio: "inherit", cwd: root, shell: true });
await wait(compose);
if (compose.exitCode !== 0) fail("Docker Desktop이 실행 중인지 확인해 주세요. 데이터베이스 볼륨은 지우지 않았습니다.");

for (let i = 0; i < 40; i++) {
  const ping = spawn("docker", ["compose", "-p", "forgeops", "exec", "-T", "postgres", "pg_isready", "-U", "forge", "-d", "forge_ops"], {
    cwd: root,
    shell: true,
    windowsHide: true, detached: process.platform === "win32", stdio: "ignore",
  });
  const code = await wait(ping);
  if (code === 0) break;
  if (i === 39) fail("Postgres가 아직 준비되지 않았습니다.");
  await delay(500);
}


try {
  const {default:pg}=await import("pg");
  const preflight=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  try {
    const {assertDevelopmentDatabase}=await import("./support/development-database.mjs");
    await assertDevelopmentDatabase(preflight);
  }finally{await preflight.end();}
}catch{fail("LOCAL_DEVELOPMENT_DATABASE_REQUIRED: DB 식별자를 확인하지 못해 마이그레이션하지 않습니다.");}

const migrate = spawn("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
  windowsHide: true, detached: process.platform === "win32", stdio: "inherit",
  cwd: root,
  shell: true,
  env: process.env,
});
await wait(migrate);
if (migrate.exitCode !== 0) fail("데이터베이스 준비에 실패했습니다.");
const children = [
  spawn(process.execPath, ["--import", "tsx", "scripts/backup-scheduler.mjs"], { windowsHide: true, detached: process.platform === "win32", stdio: "inherit", cwd: root, env: process.env }),
  spawn("pnpm", ["--filter", "@forge-ops/api", "start"], { windowsHide: true, detached: process.platform === "win32", stdio: "inherit", cwd: root, shell: true, env: process.env }),
  spawn("pnpm", ["--filter", "@forge-ops/worker", "start"], { windowsHide: true, detached: process.platform === "win32", stdio: "inherit", cwd: root, shell: true, env: process.env }),
  spawn("pnpm", ["--filter", "@forge-ops/web", "dev"], { windowsHide: true, detached: process.platform === "win32", stdio: "inherit", cwd: root, shell: true, env: process.env }),
];

const browserClient = await startOptionalBrowserClient({root,source:process.env});

console.log("웹 http://localhost:5173  API http://localhost:3001  Mailpit http://localhost:8025");

function shutdown() {
  browserClient?.child.kill("SIGTERM");
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.race(children.map((c) => wait(c)));
shutdown();

function wait(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.on("close", resolve));
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
