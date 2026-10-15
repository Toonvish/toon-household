// Guards of docker/toon-deploy.sh (M6-T04, SPEC D11, plan m6-deploy.md decision 11).
// The script is a forced SSH command: every case runs it with stubbed `docker` and `curl` on PATH,
// so the suite needs no Docker, no network and no root.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../docker/toon-deploy.sh");
const DIGEST = `sha256:${"ab12".repeat(16)}`;
const IMAGE = "ghcr.io/toonvish/toon-household";

const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s | TOON_IMAGE=%s\\n' "$*" "\${TOON_IMAGE:-}" >> "$STUB_LOG"
case "$*" in
  "inspect "*) printf '%s\\n' "\${STUB_HEALTH:-healthy}" ;;
  "compose ps -q app") echo cid ;;
  "compose config -q") exit "\${STUB_CONFIG:-0}" ;;
  "compose run "*validate*) exit "\${STUB_VALIDATE:-0}" ;;
esac
exit 0
`;

const CURL_STUB = `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "$STUB_LOG"
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
[ "\${STUB_CURL_FAIL:-0}" = 0 ] || exit 22
case "$url" in
  */docker/Caddyfile) printf '%s' "\${STUB_BODY_CADDY:-new caddyfile}" > "$out" ;;
  */docker-compose.yml) printf '%s' "\${STUB_BODY_COMPOSE:-new compose}" > "$out" ;;
  *) printf 'unexpected url' > "$out" ;;
esac
`;

let root: string;
let appDir: string;
let log: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "toon-deploy-"));
  const bin = join(root, "bin");
  appDir = join(root, "app");
  log = join(root, "calls.log");
  mkdirSync(bin);
  mkdirSync(join(appDir, "docker"), { recursive: true });
  writeFileSync(join(bin, "docker"), DOCKER_STUB);
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(log, "");
  writeFileSync(join(appDir, ".env"), "SESSION_SECRET=s3cret\nTOON_IMAGE=ghcr.io/toonvish/toon-household:old\nTOON_HOSTNAME=h.example\n");
  writeFileSync(join(appDir, "docker-compose.yml"), "old compose");
  writeFileSync(join(appDir, "docker/Caddyfile"), "old caddyfile");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

type Run = { code: number; out: string; err: string; calls: string[] };

function run(request: string, env: Record<string, string> = {}, cwd = root): Run {
  const proc = Bun.spawnSync(["bash", SCRIPT], {
    cwd,
    env: {
      PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
      HOME: root,
      TOON_APP_DIR: appDir,
      TOON_HEALTH_SLEEP: "0",
      TOON_HEALTH_TRIES: "3",
      STUB_LOG: log,
      SSH_ORIGINAL_COMMAND: request,
      ...env,
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString(), calls };
}

const envFile = () => readFileSync(join(appDir, ".env"), "utf8");
const compose = () => readFileSync(join(appDir, "docker-compose.yml"), "utf8");
const caddyfile = () => readFileSync(join(appDir, "docker/Caddyfile"), "utf8");

describe("deploy", () => {
  test("latest pulls and starts the pinned repository, then pins .env", () => {
    const r = run("deploy latest");
    expect(r.code).toBe(0);
    expect(r.calls).toContain(`docker compose pull | TOON_IMAGE=${IMAGE}:latest`);
    expect(r.calls).toContain(`docker compose up -d --remove-orphans | TOON_IMAGE=${IMAGE}:latest`);
    expect(envFile()).toContain(`TOON_IMAGE=${IMAGE}:latest\n`);
    expect(envFile()).toContain("SESSION_SECRET=s3cret");
    expect(envFile().match(/TOON_IMAGE=/g)?.length).toBe(1);
  });

  test("no argument means latest", () => {
    const r = run("deploy");
    expect(r.code).toBe(0);
    expect(envFile()).toContain(`TOON_IMAGE=${IMAGE}:latest`);
  });

  test("a digest deploys by digest", () => {
    const r = run(`deploy ${DIGEST}`);
    expect(r.code).toBe(0);
    expect(r.calls).toContain(`docker compose pull | TOON_IMAGE=${IMAGE}@${DIGEST}`);
    expect(envFile()).toContain(`TOON_IMAGE=${IMAGE}@${DIGEST}\n`);
  });

  test("a .env without TOON_IMAGE gets the line appended", () => {
    writeFileSync(join(appDir, ".env"), "SESSION_SECRET=s3cret\n");
    expect(run("deploy latest").code).toBe(0);
    expect(envFile()).toBe(`SESSION_SECRET=s3cret\nTOON_IMAGE=${IMAGE}:latest\n`);
  });

  test("a malformed digest is refused before any docker call", () => {
    for (const bad of ["sha256:abc", `sha256:${"A".repeat(64)}`, `sha256:${"a".repeat(65)}`]) {
      const r = run(`deploy ${bad}`);
      expect(r.code).toBe(1);
      expect(r.err).toContain("ERROR:");
      expect(r.calls).toEqual([]);
    }
  });

  test("a glob is not expanded (set -f)", () => {
    const cwd = join(root, "cwd");
    mkdirSync(cwd);
    for (const name of ["alpha.txt", "beta.txt"]) writeFileSync(join(cwd, name), "");
    const r = run("deploy *", {}, cwd);
    expect(r.code).toBe(1);
    expect(r.err).toContain("*");
    expect(r.err).not.toContain("alpha.txt");
    expect(r.err).not.toContain("beta.txt");
    expect(r.calls).toEqual([]);
  });

  test("injected and extra arguments are refused", () => {
    for (const bad of ["deploy latest; id", "deploy latest extra", "deploy latest;id", "deploy $(id)", "deploy latest && id", "deploy ghcr.io/evil/image:latest", "deploy ../x"]) {
      const r = run(bad);
      expect(r.code).toBe(1);
      expect(r.calls).toEqual([]);
    }
    expect(envFile()).toContain(":old");
  });

  test("a client cannot choose the repository", () => {
    const r = run(`deploy evil.example/x@${DIGEST}`);
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
  });

  test("an unhealthy container exits 1 and leaves .env untouched", () => {
    const before = envFile();
    const r = run("deploy latest", { STUB_HEALTH: "unhealthy" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("was NOT adopted");
    expect(envFile()).toBe(before);
    expect(r.calls.some((c) => c.startsWith("docker compose logs"))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("docker image prune"))).toBe(false);
  });

  test("a container that never reports health times out and leaves .env untouched", () => {
    const before = envFile();
    const r = run("deploy latest", { STUB_HEALTH: "starting" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("Timed out");
    expect(envFile()).toBe(before);
  });

  test("a missing .env is refused", () => {
    rmSync(join(appDir, ".env"));
    const r = run("deploy latest");
    expect(r.code).toBe(1);
    expect(r.err).toContain(".env is missing");
    expect(r.calls).toEqual([]);
  });
});

describe("verbs", () => {
  test("status runs compose ps", () => {
    const r = run("status");
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["docker compose ps | TOON_IMAGE="]);
  });

  test("status and sync-config take no arguments", () => {
    for (const bad of ["status x", "sync-config x", "sync-config latest"]) {
      const r = run(bad);
      expect(r.code).toBe(1);
      expect(r.err).toContain("takes no arguments");
      expect(r.calls).toEqual([]);
    }
  });

  test("unknown and empty verbs are refused", () => {
    for (const bad of ["rm", "rm -rf /", "bash", "", "   ", "up", "DEPLOY latest"]) {
      const r = run(bad);
      expect(r.code).toBe(1);
      expect(r.err).toContain("ERROR:");
      expect(r.calls).toEqual([]);
    }
  });

  test("arguments passed directly (no SSH_ORIGINAL_COMMAND) work the same way", () => {
    const proc = Bun.spawnSync(["bash", SCRIPT, "deploy", "latest;", "id"], {
      env: { PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`, TOON_APP_DIR: appDir, STUB_LOG: log },
    });
    expect(proc.exitCode).toBe(1);
    expect(readFileSync(log, "utf8")).toBe("");
  });
});

describe("sync-config", () => {
  test("a changed Caddyfile replaces both files, keeps backups and restarts caddy", () => {
    const r = run("sync-config", { STUB_BODY_COMPOSE: "fresh compose", STUB_BODY_CADDY: "fresh caddyfile" });
    expect(r.code).toBe(0);
    expect(compose()).toBe("fresh compose");
    expect(caddyfile()).toBe("fresh caddyfile");
    expect(readFileSync(join(appDir, "docker-compose.yml.bak"), "utf8")).toBe("old compose");
    expect(readFileSync(join(appDir, "docker/Caddyfile.bak"), "utf8")).toBe("old caddyfile");
    expect(existsSync(join(appDir, "docker-compose.yml.new"))).toBe(false);
    expect(existsSync(join(appDir, "docker/Caddyfile.new"))).toBe(false);
    expect(r.calls).toContain("docker compose config -q | TOON_IMAGE=");
    expect(r.calls).toContain(
      "docker compose run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile | TOON_IMAGE=",
    );
    expect(r.calls).toContain("docker compose restart caddy | TOON_IMAGE=");
    // validation happens before the restart
    const validate = r.calls.findIndex((c) => c.includes("validate"));
    const restart = r.calls.findIndex((c) => c.includes("restart caddy"));
    expect(validate).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(validate);
    // fetched from the pinned raw base, nothing from the client
    expect(r.calls.some((c) => c.includes("https://raw.githubusercontent.com/Toonvish/toon-household/main/docker-compose.yml"))).toBe(true);
    expect(r.calls.some((c) => c.includes("https://raw.githubusercontent.com/Toonvish/toon-household/main/docker/Caddyfile"))).toBe(true);
  });

  test("an unchanged Caddyfile does not restart caddy even when compose changed", () => {
    const r = run("sync-config", { STUB_BODY_COMPOSE: "fresh compose", STUB_BODY_CADDY: "old caddyfile" });
    expect(r.code).toBe(0);
    expect(compose()).toBe("fresh compose");
    expect(caddyfile()).toBe("old caddyfile");
    expect(r.calls.some((c) => c.includes("restart"))).toBe(false);
    expect(r.out).toContain("caddy not restarted");
  });

  test("a failing Caddyfile validation restores both files byte for byte", () => {
    const r = run("sync-config", { STUB_VALIDATE: "1", STUB_BODY_COMPOSE: "fresh compose", STUB_BODY_CADDY: "broken caddyfile" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Caddyfile is invalid");
    expect(compose()).toBe("old compose");
    expect(caddyfile()).toBe("old caddyfile");
    expect(r.calls.some((c) => c.includes("restart"))).toBe(false);
  });

  test("a failing compose validation restores both files and skips the caddy check", () => {
    const r = run("sync-config", { STUB_CONFIG: "1", STUB_BODY_COMPOSE: "broken compose", STUB_BODY_CADDY: "fresh caddyfile" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("docker-compose.yml is invalid");
    expect(compose()).toBe("old compose");
    expect(caddyfile()).toBe("old caddyfile");
    expect(r.calls.some((c) => c.includes("validate"))).toBe(false);
    expect(r.calls.some((c) => c.includes("restart"))).toBe(false);
  });

  test("a failed download changes nothing and leaves no .new files", () => {
    const r = run("sync-config", { STUB_CURL_FAIL: "1" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Download failed");
    expect(compose()).toBe("old compose");
    expect(caddyfile()).toBe("old caddyfile");
    expect(existsSync(join(appDir, "docker-compose.yml.new"))).toBe(false);
    expect(existsSync(join(appDir, "docker/Caddyfile.new"))).toBe(false);
    expect(r.calls.some((c) => c.startsWith("docker"))).toBe(false);
  });

  test("a first sync with no previous files removes the new ones when validation fails", () => {
    rmSync(join(appDir, "docker-compose.yml"));
    rmSync(join(appDir, "docker/Caddyfile"));
    const r = run("sync-config", { STUB_VALIDATE: "1" });
    expect(r.code).toBe(1);
    expect(existsSync(join(appDir, "docker-compose.yml"))).toBe(false);
    expect(existsSync(join(appDir, "docker/Caddyfile"))).toBe(false);
  });

  test("a first sync with no previous Caddyfile counts as changed", () => {
    rmSync(join(appDir, "docker/Caddyfile"));
    rmSync(join(appDir, "docker"), { recursive: true });
    const r = run("sync-config");
    expect(r.code).toBe(0);
    expect(caddyfile()).toBe("new caddyfile");
    expect(r.calls.some((c) => c.includes("restart caddy"))).toBe(true);
  });
});

describe("script hygiene", () => {
  const src = readFileSync(SCRIPT, "utf8");
  test("no eval, no German, set -f around the split", () => {
    expect(src).not.toMatch(/\beval\b\s/);
    expect(src).not.toMatch(/FEHLER|Hole |Zu viele|Unbekannter|[äöüß]/);
    expect(src).toMatch(/set -f[^\n]*\nparts=\(\$request\)\nset \+f/);
  });
  test("the allow-list names exactly the three verbs and pins the repository", () => {
    expect(src).toContain("deploy, sync-config, status");
    expect(src).toContain('IMAGE_REPO="${TOON_IMAGE_REPO:-ghcr.io/toonvish/toon-household}"');
    expect(src).toContain("/usr/local/bin/toon-household-deploy");
  });
});
