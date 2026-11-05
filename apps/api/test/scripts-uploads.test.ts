/**
 * `uploads-gc.ts` and `localize-images.ts` (docs/EFFECT.md E10; plan `docs/plans/e5-scripts.md` P1, P2, P5, P6, P11, P13,
 * E5-T04).
 *
 * Subprocess characterisation exactly as the operator runs the two scripts: a real `NODE_ENV=development` (never the
 * inherited `test`), an absolute `DATABASE_URL`, an explicit `UPLOAD_DIR` and `SESSION_SECRET`, no network. They were
 * written and run green against the UNCONVERTED scripts first and pass unchanged against the Effect programs (P13). They
 * assert exit codes and lines both versions print (the trailing `[db] database closed` of P3 is neither asserted present
 * nor absent).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";

/** Subprocess budget: parallel worktrees put the host under heavy load (plan P13). */
const SPAWN_TIMEOUT_MS = 120_000;

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SCRIPTS = join(REPO_ROOT, "apps/api/scripts");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "toon-household-scripts-uploads-"));
  dirs.push(dir);
  return dir;
}

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runScript(script: string, dir: string, args: string[] = []): Spawned {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: `file:${join(dir, "x.db")}`,
    UPLOAD_DIR: join(dir, "uploads"),
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  };
  delete env.TEST_DATABASE_URL;
  delete env.DATABASE_AUTH_TOKEN;
  delete env.IMPORT_ALLOW_PRIVATE_HOSTS;
  const proc = Bun.spawnSync({
    cmd: ["bun", join(SCRIPTS, script), ...args],
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function lines(out: string): string[] {
  return out.split("\n").filter((line) => line.length > 0);
}

function writeAged(dir: string, name: string, ageHours: number): string {
  const file = join(dir, "uploads", name);
  writeFileSync(file, "x");
  const when = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  utimesSync(file, when, when);
  return file;
}

describe("bun apps/api/scripts/uploads-gc.ts (subprocess)", () => {
  test(
    "a missing UPLOAD_DIR is nothing to do",
    () => {
      const dir = tempDir();
      expect(runScript("migrate.ts", dir).code).toBe(0);
      const run = runScript("uploads-gc.ts", dir);
      expect(run.code).toBe(0);
      expect(lines(run.stdout)).toContain(`[uploads:gc] ${join(dir, "uploads")} does not exist — nothing to do.`);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "--dry-run lists the deletable files and deletes nothing",
    () => {
      const dir = tempDir();
      expect(runScript("migrate.ts", dir).code).toBe(0);
      mkdirSync(join(dir, "uploads"));
      const old = writeAged(dir, "old.jpg", 48);
      const young = writeAged(dir, "young.jpg", 0);
      const thumb = writeAged(dir, "old.thumb.webp", 48);
      const run = runScript("uploads-gc.ts", dir, ["--dry-run"]);
      expect(run.code).toBe(0);
      const out = lines(run.stdout);
      expect(out).toContain("[uploads:gc] would delete: old.jpg (0 KB)");
      expect(out).toContain("[uploads:gc] would delete: old.thumb.webp (0 KB)");
      expect(out).toContain("[uploads:gc] 3 files checked, 0 referenced, 1 too young (< 24 h), 2 deletable (0.0 MB).");
      expect([old, young, thumb].every((file) => existsSync(file))).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "without --dry-run it deletes the old files and keeps the young one; --min-age-hours=0 takes that too",
    () => {
      const dir = tempDir();
      expect(runScript("migrate.ts", dir).code).toBe(0);
      mkdirSync(join(dir, "uploads"));
      const old = writeAged(dir, "old.jpg", 48);
      const young = writeAged(dir, "young.jpg", 0);
      const thumb = writeAged(dir, "old.thumb.webp", 48);
      const run = runScript("uploads-gc.ts", dir);
      expect(run.code).toBe(0);
      expect(lines(run.stdout)).toContain(
        "[uploads:gc] 3 files checked, 0 referenced, 1 too young (< 24 h), 2 deleted (0.0 MB).",
      );
      expect(existsSync(old)).toBe(false);
      expect(existsSync(thumb)).toBe(false);
      expect(existsSync(young)).toBe(true);

      const second = runScript("uploads-gc.ts", dir, ["--min-age-hours=0"]);
      expect(second.code).toBe(0);
      expect(lines(second.stdout)).toContain(
        "[uploads:gc] 1 files checked, 0 referenced, 0 too young (< 0 h), 1 deleted (0.0 MB).",
      );
      expect(existsSync(young)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "--min-age-hours=abc behaves as 24",
    () => {
      const dir = tempDir();
      expect(runScript("migrate.ts", dir).code).toBe(0);
      mkdirSync(join(dir, "uploads"));
      const young = writeAged(dir, "young.jpg", 0);
      const run = runScript("uploads-gc.ts", dir, ["--min-age-hours=abc"]);
      expect(run.code).toBe(0);
      expect(lines(run.stdout)).toContain(
        "[uploads:gc] 1 files checked, 0 referenced, 1 too young (< 24 h), 0 deleted (0.0 MB).",
      );
      expect(existsSync(young)).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "a file a row references is kept, and so is the thumbnail of a referenced original",
    async () => {
      const dir = tempDir();
      expect(runScript("migrate.ts", dir).code).toBe(0);
      mkdirSync(join(dir, "uploads"));
      const kept = writeAged(dir, "kept.jpg", 48);
      const keptThumb = writeAged(dir, "kept.jpg.thumb.webp", 48);
      const gone = writeAged(dir, "gone.jpg", 48);
      const client = createClient({ url: `file:${join(dir, "x.db")}` });
      try {
        await client.execute({
          sql: "INSERT INTO users (id, name, avatar_url, created_at, updated_at) VALUES ('u1', 'U', '/uploads/kept.jpg', 0, 0)",
          args: [],
        });
      } catch (error) {
        client.close();
        throw error;
      }
      client.close();
      const run = runScript("uploads-gc.ts", dir);
      expect(run.code).toBe(0);
      expect(lines(run.stdout)).toContain(
        "[uploads:gc] 3 files checked, 1 referenced, 0 too young (< 24 h), 1 deleted (0.0 MB).",
      );
      expect(existsSync(kept)).toBe(true);
      expect(existsSync(keptThumb)).toBe(true);
      expect(existsSync(gone)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("bun apps/api/scripts/localize-images.ts (subprocess)", () => {
  const REMOTE = "http://127.0.0.1:9/x.jpg";

  /** A migrated and seeded database whose first recipe points at the unreachable private-host URL. */
  async function seededWithRemote(dir: string): Promise<string> {
    expect(runScript("migrate.ts", dir).code).toBe(0);
    expect(runScript("seed.ts", dir).code).toBe(0);
    const client = createClient({ url: `file:${join(dir, "x.db")}` });
    try {
      await client.execute("UPDATE recipe_recipes SET image_url = NULL");
      const first = await client.execute("SELECT id FROM recipe_recipes LIMIT 1");
      const id = String(first.rows[0]?.id);
      await client.execute({ sql: "UPDATE recipe_recipes SET image_url = ? WHERE id = ?", args: [REMOTE, id] });
      return id;
    } finally {
      client.close();
    }
  }

  test(
    "--dry-run lists the remote image and downloads nothing",
    async () => {
      const dir = tempDir();
      const id = await seededWithRemote(dir);
      const run = runScript("localize-images.ts", dir, ["--dry-run"]);
      expect(run.code).toBe(0);
      const out = lines(run.stdout);
      expect(out).toContain("[recipe:localize-images] 1 recipe image(s), 0 collection cover(s) still remote (dry run).");
      expect(out).toContain(`  recipe ${id}  ${REMOTE}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "an unreachable (private-host) image keeps its remote URL and is listed",
    async () => {
      const dir = tempDir();
      const id = await seededWithRemote(dir);
      const run = runScript("localize-images.ts", dir);
      expect(run.code).toBe(0);
      const out = lines(run.stdout);
      expect(out).toContain("[recipe:localize-images] 1 recipe image(s), 0 collection cover(s) still remote.");
      expect(out).toContain("[recipe:localize-images] 0 copied, 1 not reachable (kept remote).");
      expect(out).toContain(`  recipe ${id}  ${REMOTE}`);
      const client = createClient({ url: `file:${join(dir, "x.db")}` });
      try {
        const row = await client.execute({ sql: "SELECT image_url FROM recipe_recipes WHERE id = ?", args: [id] });
        expect(row.rows[0]?.image_url).toBe(REMOTE);
      } finally {
        client.close();
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});
