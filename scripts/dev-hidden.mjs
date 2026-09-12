import { closeSync, mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const logDirectory = path.join(root, "data");
mkdirSync(logDirectory, { recursive: true });

const stdout = openSync(path.join(logDirectory, "dev-server.log"), "a");
const stderr = openSync(path.join(logDirectory, "dev-server.error.log"), "a");
const child = spawn(process.execPath, [path.join(root, "scripts/dev.mjs")], {
  cwd: root,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", stdout, stderr],
  env: process.env,
});
closeSync(stdout);
closeSync(stderr);
child.unref();

console.log("Forge Kitchen Ops dev server started in the background.");
console.log("Web: http://localhost:5173");
console.log("Logs: data/dev-server.log, data/dev-server.error.log");
