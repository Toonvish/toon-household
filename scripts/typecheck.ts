/**
 * Type-checks every workspace project sequentially. Fails with a non-zero exit code
 * if any project has type errors.
 *
 * apps/web is THREE projects, not one: its files run in three different runtimes and
 * tsc has one global scope per program, so each gets its own `types`. Adding a project
 * to apps/web means adding a line here — nothing discovers them.
 */
const projects: Array<[dir: string, config: string]> = [
  ["packages/shared", "tsconfig.json"],
  ["apps/api", "tsconfig.json"],
  ["apps/web", "tsconfig.json"],
  ["apps/web", "tsconfig.test.json"],
  ["apps/web", "tsconfig.node.json"],
];
const root = new URL("../", import.meta.url).pathname;

let failed = false;
for (const [dir, config] of projects) {
  console.log(`[typecheck] ${dir}/${config}`);
  const proc = Bun.spawn(["bunx", "tsc", "-p", config, "--noEmit"], {
    cwd: `${root}${dir}`,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) failed = true;
}

if (failed) {
  console.error("[typecheck] FAILED");
  process.exit(1);
}
console.log("[typecheck] OK");
