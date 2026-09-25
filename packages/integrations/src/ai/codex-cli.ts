import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiWireInput, AiWireResult } from "./transport.ts";

// Product text is untrusted, so the agent gets no tools (no shell, apps, plugins, hooks or browser), an empty
// working directory and a minimal environment: it can only answer.
const DISABLED_FEATURES = ["shell_tool", "unified_exec", "apps", "plugins", "hooks", "browser_use", "computer_use", "in_app_browser"];
const TIMEOUT_MS = 180_000;

export type CodexRun = (args: readonly string[], stdin: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<number | null>;

const runCodex: CodexRun = (args, stdin, env, timeoutMs) => new Promise(resolve => {
  const child = spawn(env.CODEX_BIN || "codex", args, { env, stdio: ["pipe", "ignore", "ignore"] });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.on("error", () => { clearTimeout(timer); resolve(null); });
  child.on("close", (code, signal) => { clearTimeout(timer); resolve(signal ? null : code); });
  child.stdin.end(stdin);
});

export async function sendViaCodex(input: AiWireInput, run: CodexRun = runCodex, env: NodeJS.ProcessEnv = process.env): Promise<AiWireResult> {
  const prompt = input.messages.map(message => (message.role === "system" ? "Instructions:\n" : "Data:\n") + message.content).join("\n\n");
  if (Buffer.byteLength(prompt, "utf8") > input.maxInputTokens) return { kind: "not_sent", code: "PROVIDER_INPUT_TOO_LARGE" };
  const dir = await mkdtemp(path.join(tmpdir(), "forge-codex-"));
  try {
    const out = path.join(dir, "last-message.txt");
    const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never",
      ...DISABLED_FEATURES.flatMap(feature => ["--disable", feature]), "-c", "shell_environment_policy.inherit=none",
      "-C", dir, "-o", out, ...(input.model === "default" ? [] : ["-m", input.model]), "-"];
    const code = await run(args, prompt, { PATH: env.PATH, HOME: env.HOME, CODEX_HOME: env.CODEX_HOME, CODEX_BIN: env.CODEX_BIN }, TIMEOUT_MS);
    if (code === null) return { kind: "unknown", code: "PROVIDER_OUTCOME_UNKNOWN" };
    const content = await readFile(out, "utf8").then(text => text.trim(), () => null);
    // Plan limits and sign-in problems end the CLI with a nonzero code and no final message.
    if (code !== 0 || !content) return { kind: "response", status: 502, body: null };
    const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(content)?.[1] ?? content;
    return { kind: "response", status: 200, body: { choices: [{ message: { content: unfenced } }] } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
