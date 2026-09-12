import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeAuthority } from "./runtime-authority.ts";
export async function runtimeEnvironment(
  authority: RuntimeAuthority,
  source: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (authority.appEnv === "development") return source;
  const forbidden = [
    "ENCRYPTION_KEY",
    "BROWSER_SIGNING_KEY",
    "BETTER_AUTH_SECRET",
    "JS_API_KEY",
    "JS_API_KEY_NAME",
    "COMPOSIO_API_KEY",
  ];
  if (process.platform !== "linux" || forbidden.some((name) => source[name]))
    throw new Error("PRODUCTION_SERVICE_CREDENTIALS_REQUIRED");
  const root = source.CREDENTIALS_DIRECTORY;
  if (!root || root !== `/run/credentials/forge-ops-${authority.service}.service` ||
    !path.isAbsolute(root) || path.normalize(root) !== root)
    throw new Error("PRODUCTION_SERVICE_CREDENTIALS_REQUIRED");
  const credentialDirectory = root;
  const result = { ...source };
  async function credential(name: string): Promise<string> {
    try {
      const directory = await lstat(credentialDirectory),
        file = await lstat(path.join(credentialDirectory, name));
      const uid = process.getuid?.();
      if (
        uid === undefined ||
        !directory.isDirectory() ||
        ![0, uid].includes(directory.uid) ||
        (directory.mode & 0o022) !== 0 ||
        !file.isFile() ||
        ![0, uid].includes(file.uid) ||
        (file.mode & 0o077) !== 0 ||
        file.size < 1 ||
        file.size > 65536
      )
        throw new Error("credential policy");
      const value = (
        await readFile(path.join(credentialDirectory, name), "utf8")
      ).trim();
      if (!value) throw new Error("empty credential");
      return value;
    } catch {
      throw new Error("PRODUCTION_SERVICE_CREDENTIALS_REQUIRED");
    }
  }
  if (authority.service !== "scheduler")
    result.ENCRYPTION_KEY = await credential("encryption-key");
  if (authority.service === "api")
    result.BETTER_AUTH_SECRET = await credential("auth-secret");
  if (authority.service !== "api" && source.JS_TRANSPORT === "official") {
    result.JS_API_KEY_NAME = await credential("js-api-key-name");
    result.JS_API_KEY = await credential("js-api-key");
  }
  if (authority.service === "api" && source.COMPOSIO_ENABLED === "true")
    result.COMPOSIO_API_KEY = await credential("composio-api-key");
  if(authority.service==="worker"&&source.BROWSER_TASKS_ENABLED==="true")
    result.BROWSER_SIGNING_KEY=await credential("browser-signing-key");
  return result;
}
