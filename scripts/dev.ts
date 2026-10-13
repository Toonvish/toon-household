/**
 * Runs the API and the web dev server concurrently without extra dependencies.
 * Usage: bun run dev
 */
import { existsSync } from "node:fs";

type Child = { name: string; proc: Bun.Subprocess };

const apiDir = new URL("../apps/api/", import.meta.url).pathname;
const webDir = new URL("../apps/web/", import.meta.url).pathname;

const targets = [{ name: "api", cwd: apiDir, cmd: ["bun", "run", "dev"] }];

if (existsSync(`${webDir}vite.config.ts`)) {
  targets.push({ name: "web", cwd: webDir, cmd: ["bun", "run", "dev"] });
} else {
  console.warn("[dev] apps/web/vite.config.ts fehlt — starte nur die API (bun run dev:web sobald das Web-App-Setup steht).");
}

const children: Child[] = targets.map(({ name, cwd, cmd }) => ({
  name,
  proc: Bun.spawn(cmd, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  }),
}));

let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.proc.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await Promise.all(
  children.map(async (child) => {
    const code = await child.proc.exited;
    if (!shuttingDown) {
      console.error(`[dev] ${child.name} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  }),
);
