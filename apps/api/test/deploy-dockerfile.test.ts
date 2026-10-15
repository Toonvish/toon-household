/**
 * Pins the load-bearing lines of the deploy artefacts (SPEC D11, M6-T01): the
 * Dockerfile, .dockerignore and docker/entrypoint.sh. The image is never built
 * here (docker runs in M6-T08); these tests read the files and fail when a line
 * that a later edit must not change disappears or moves.
 *
 * Ported from toon-recipe's Dockerfile, .dockerignore and entrypoint.sh, with
 * the rewrites listed in docs/plans/m6-deploy.md section 5 T01.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");
const entrypointPath = join(ROOT, "docker/entrypoint.sh");
const entrypoint = read("docker/entrypoint.sh");

/** The text of one build stage: from its `FROM … AS <name>` line to the next `FROM`. */
function stage(name: string): string {
  const start = dockerfile.indexOf(`AS ${name}\n`);
  expect(start).toBeGreaterThan(-1);
  const next = dockerfile.indexOf("\nFROM ", start);
  return dockerfile.slice(start, next === -1 ? undefined : next);
}

function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim());
}

describe("Dockerfile", () => {
  test("BUN_VERSION is the repo's .bun-version", () => {
    const m = dockerfile.match(/^ARG BUN_VERSION=(.+)$/m);
    expect(m?.[1]).toBe(read(".bun-version").trim());
  });

  test("header names toon-household, not toon-recipe", () => {
    expect(dockerfile.split("\n")[2]).toBe("# toon-household — one image, one origin, one port.");
    expect(dockerfile).not.toContain("toon-recipe");
  });

  test("web-build sets PUBLIC_API_URL to empty before the build and fails on the dev API URL", () => {
    const web = stage("web-build");
    const env = web.indexOf('ENV PUBLIC_API_URL=""');
    const build = web.indexOf("RUN bun --filter @toon/web build");
    expect(env).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(env);
    expect(web).toContain("&& ! grep -rqF 'localhost:3001' apps/web/dist");
    expect(web).toContain("test -f apps/web/dist/sw.js");
  });

  test("manifests stage copies the lockfile, the root tsconfig and each workspace manifest", () => {
    const m = lines(stage("manifests"));
    expect(m).toContain("COPY package.json bun.lock ./");
    expect(m).toContain("COPY tsconfig.json ./");
    expect(m).toContain("COPY apps/api/package.json ./apps/api/");
    expect(m).toContain("COPY apps/web/package.json ./apps/web/");
    expect(m).toContain("COPY packages/shared/package.json ./packages/shared/");
  });

  test("runtime copies the three node_modules trees (Bun 1.4 isolated linker)", () => {
    const rt = lines(dockerfile);
    expect(rt).toContain("COPY --from=deps /app/node_modules ./node_modules");
    expect(rt).toContain("COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules");
    expect(rt).toContain("COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules");
  });

  test("OCR and PDF are build args that default off, with runtime flags defaulting to them", () => {
    expect(dockerfile).toContain("ARG WITH_OCR=0");
    expect(dockerfile).toContain("ARG WITH_PDF=${WITH_OCR}");
    expect(dockerfile).toContain("IMPORT_OCR_ENABLED=${WITH_OCR}");
    expect(dockerfile).toContain("IMPORT_PDF_ENABLED=${WITH_PDF}");
    expect(dockerfile).toContain("tesseract-ocr-deu");
    expect(dockerfile).toContain("poppler-utils");
    expect(dockerfile).toContain("tini");
  });

  test("runtime environment points the API at the bundled PWA and the data volume", () => {
    expect(dockerfile).toContain("WEB_DIST_DIR=/app/apps/web/dist");
    expect(dockerfile).toContain('DATABASE_URL="file:/app/data/local.db"');
    expect(dockerfile).toContain("UPLOAD_DIR=/app/data/uploads");
  });

  test("runs as the unprivileged bun user with the data volume and port 3001", () => {
    const rt = lines(dockerfile);
    expect(rt).toContain("USER bun");
    expect(rt).toContain('VOLUME ["/app/data"]');
    expect(rt).toContain("EXPOSE 3001");
  });

  test("HEALTHCHECK probes the API's own health endpoint", () => {
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    expect(dockerfile).toContain("/api/health");
  });

  test("ENTRYPOINT is tini around the entrypoint and CMD starts the API", () => {
    const rt = lines(dockerfile);
    expect(rt).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]');
    expect(rt).toContain('CMD ["bun", "apps/api/src/index.ts"]');
  });

  test("the migration runbook's step 6 is cross-referenced at the uid comment", () => {
    expect(dockerfile).toContain("# docs/migration.md step 6 chowns a pre-filled volume to this uid.");
  });

  test("the two German build echoes are replaced by the English ones", () => {
    expect(dockerfile).toContain(
      'echo "[build] OCR left out (WITH_OCR=$WITH_OCR): photo import is disabled."',
    );
    expect(dockerfile).toContain(
      'echo "[build] poppler left out (WITH_PDF=$WITH_PDF): PDF import is disabled."',
    );
    expect(dockerfile).not.toContain("weggelassen");
  });
});

describe(".dockerignore", () => {
  const ignored = new Set(lines(dockerignore));

  test("keeps secrets out and the example template in", () => {
    expect(ignored.has(".env")).toBe(true);
    expect(ignored.has(".env.*")).toBe(true);
    expect(ignored.has("!.env.example")).toBe(true);
    expect(ignored.has("!.env.local-stack")).toBe(false);
  });

  test("keeps host node_modules, local data and test trees out of the context", () => {
    expect(ignored.has("**/node_modules")).toBe(true);
    expect(ignored.has("data")).toBe(true);
    expect(ignored.has("**/data")).toBe(true);
    expect(ignored.has("apps/api/test")).toBe(true);
    expect(ignored.has("packages/shared/test")).toBe(true);
  });

  test("keeps the migration inputs, outputs and worktrees out of the context", () => {
    expect(ignored.has("migration-in")).toBe(true);
    expect(ignored.has("migration-out")).toBe(true);
    expect(ignored.has(".worktrees")).toBe(true);
  });
});

describe("docker/entrypoint.sh", () => {
  test("is a POSIX sh script with fail-fast options", () => {
    expect(entrypoint.startsWith("#!/bin/sh\n")).toBe(true);
    expect(entrypoint).toContain("set -eu");
  });

  test("applies migrations before handing over, and a failure stops the container", () => {
    expect(entrypoint).toContain("bun apps/api/scripts/migrate.ts");
    expect(entrypoint).toContain('exec "$@"');
    expect(entrypoint.indexOf("migrate.ts")).toBeLessThan(entrypoint.indexOf('exec "$@"'));
  });

  test("SKIP_MIGRATIONS logs in English", () => {
    expect(entrypoint).toContain('log "SKIP_MIGRATIONS=1 — skipping migrations"');
  });

  test("is executable", () => {
    expect(statSync(entrypointPath).mode & 0o111).not.toBe(0);
  });
});

describe("German is gone from the deploy files", () => {
  test("no umlaut or German build word in the Dockerfile, .dockerignore or entrypoint", () => {
    const pattern = /[äöüÄÖÜß]|weggelassen|übersprungen|Migrationen|deaktiviert/;
    for (const text of [dockerfile, dockerignore, entrypoint]) {
      expect(text).not.toMatch(pattern);
    }
  });
});
