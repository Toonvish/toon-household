// Guards of the GitHub workflows that publish and roll out the image (M6-T05, plan m6-deploy.md
// section 5 T05 and decisions 1, 2 and 12). Ported from toon-finance's release.yml, deploy.yml and
// ci.yml (its SHA-pinned actions, gotcha 74) with R's poppler step and build args.
// The workflows cannot run here (no GitHub Actions on this machine), so the structure is pinned by
// parsing the YAML: the SHA rule, the trigger and gate shapes, the step order and the German-free text.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const RELEASE_SRC = read(".github/workflows/release.yml");
const DEPLOY_SRC = read(".github/workflows/deploy.yml");
const CI_SRC = read(".github/workflows/ci.yml");

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; if?: string };
type Job = { needs?: string | string[]; if?: string; uses?: string; steps?: Step[]; outputs?: Record<string, string>; concurrency?: unknown; environment?: unknown; permissions?: unknown; with?: Record<string, unknown>; secrets?: unknown };
type Workflow = { name: string; on: Record<string, unknown>; concurrency?: { group: string; "cancel-in-progress": boolean } | string; jobs: Record<string, Job> };

const release = Bun.YAML.parse(RELEASE_SRC) as Workflow;
const deploy = Bun.YAML.parse(DEPLOY_SRC) as Workflow;
const ci = Bun.YAML.parse(CI_SRC) as Workflow;

// Typed accessors: the repo compiles with noUncheckedIndexedAccess, so a missing job or input
// is a thrown test failure rather than an undefined read.
function jobOf(wf: Workflow, id: string): Job {
  const job = wf.jobs[id];
  if (!job) throw new Error(`no job ${id}`);
  return job;
}
type Input = { type: string; required: boolean; default: string | boolean; description: string };
function inputOf(wf: Workflow, trigger: "workflow_call" | "workflow_dispatch", name: string): Input {
  const inputs = (wf.on[trigger] as { inputs: Record<string, Input> }).inputs;
  const input = inputs[name];
  if (!input) throw new Error(`no input ${name}`);
  return input;
}

const SHA_USES = /^[^@\s]+@[0-9a-f]{40}$/;
const LOCAL_REUSABLE = /^\.\/\.github\/workflows\//;

// Every step-level `uses:` in a workflow (jobs.<id>.steps[i].uses). Job-level `uses:` (a reusable
// workflow call) is checked separately below: it names a local file and has no @ref to pin.
function stepUses(wf: Workflow): Array<{ job: string; uses: string }> {
  const out: Array<{ job: string; uses: string }> = [];
  for (const [job, def] of Object.entries(wf.jobs)) {
    for (const step of def.steps ?? []) {
      if (typeof step.uses === "string") out.push({ job, uses: step.uses });
    }
  }
  return out;
}

const GERMAN_PHRASES = [
  "Nach dem Build",
  "veröffentlicht",
  "Ausrollen",
  "Deploy-Job",
  "Von Hand",
  "auf dem Server",
  "Auf dem Server",
  "ausführen",
  "Kein gültiger",
  "ist leer",
  "oder leer",
  "Gruppe",
  "toon-edge",
];

describe("step-level uses are pinned to a commit SHA", () => {
  for (const [name, wf] of [
    ["release.yml", release],
    ["deploy.yml", deploy],
    ["ci.yml", ci],
  ] as const) {
    test(`${name}: every step uses a 40-hex SHA`, () => {
      for (const { uses: u } of stepUses(wf)) expect(u).toMatch(SHA_USES);
    });
  }

  test("release.yml and ci.yml do use actions (the SHA rule is not vacuous)", () => {
    expect(stepUses(release).length).toBeGreaterThan(5);
    expect(stepUses(ci).length).toBeGreaterThan(5);
    // deploy.yml runs only ssh: it has no step-level action at all.
    expect(stepUses(deploy)).toHaveLength(0);
  });

  test("the SHA rule finds no tag-pinned action in the three files", () => {
    for (const src of [RELEASE_SRC, DEPLOY_SRC, CI_SRC]) {
      expect(src).not.toMatch(/uses:\s*[^\s@]+@v\d/);
    }
  });

  test("the job-level reusable call is local and exempt from the SHA rule", () => {
    const call = jobOf(release, "deploy").uses;
    expect(call).toBe("./.github/workflows/deploy.yml");
    expect(call).toMatch(LOCAL_REUSABLE);
    expect(call).not.toMatch(/@/);
    // The local call is the only job-level uses in release.yml; ci.yml has none.
    expect(Object.values(release.jobs).filter((j) => j.uses !== undefined)).toHaveLength(1);
    expect(Object.values(ci.jobs).filter((j) => j.uses !== undefined)).toHaveLength(0);
  });
});

describe("release.yml", () => {
  test("triggers: push to main, v* tags and a manual dispatch with a deploy checkbox", () => {
    expect(release.on.push).toEqual({ branches: ["main"], tags: ["v*"] });
    expect(release.on).toHaveProperty("workflow_dispatch");
    const input = inputOf(release, "workflow_dispatch", "deploy");
    expect(input.type).toBe("boolean");
    expect(input.default).toBe(false);
  });

  test("the build job publishes an image digest as an output", () => {
    expect(jobOf(release, "build").outputs?.digest).toBe("${{ steps.build.outputs.digest }}");
  });

  test("step order: typecheck, then poppler, then test, then Build and push", () => {
    const steps = jobOf(release, "build").steps ?? [];
    const idx = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const typecheck = idx((s) => s.run === "bun run typecheck");
    const poppler = idx((s) => s.name === "Install poppler");
    const test_ = idx((s) => s.run === "bun test");
    const build = idx((s) => s.name === "Build and push");
    for (const i of [typecheck, poppler, test_, build]) expect(i).toBeGreaterThanOrEqual(0);
    expect(typecheck).toBeLessThan(poppler);
    expect(poppler).toBeLessThan(test_);
    expect(test_).toBeLessThan(build);
  });

  test("poppler step installs poppler-utils (pdf-rasterize.test.ts needs pdftoppm)", () => {
    const step = (jobOf(release, "build").steps ?? []).find((s) => s.name === "Install poppler");
    expect(step?.run).toContain("poppler-utils");
  });

  test("the test step runs without DATABASE_URL set on the job", () => {
    expect(RELEASE_SRC).not.toMatch(/DATABASE_URL:/);
  });

  test("the image is built with WITH_OCR=1 and WITH_PDF=0, multi-arch, pushed, without provenance", () => {
    const build = (jobOf(release, "build").steps ?? []).find((s) => s.name === "Build and push");
    const w = build?.with ?? {};
    expect(w.platforms).toBe("linux/arm64,linux/amd64");
    expect(w.push).toBe(true);
    expect(w.provenance).toBe(false);
    expect(String(w["build-args"]).split("\n").map((l) => l.trim()).filter(Boolean)).toEqual(["WITH_OCR=1", "WITH_PDF=0"]);
  });

  test("the latest tag is gated on the default branch", () => {
    const meta = (jobOf(release, "build").steps ?? []).find((s) => s.name === "Tags and labels");
    expect(String(meta?.with?.tags)).toContain("type=raw,value=latest,enable={{is_default_branch}}");
  });

  test("the deploy job is gated by the DEPLOY_ENABLED repository variable and calls deploy.yml with the digest", () => {
    const job = jobOf(release, "deploy");
    expect(job.needs).toBe("build");
    expect(job.if).toContain("vars.DEPLOY_ENABLED == 'true'");
    expect(job.with?.image_digest).toBe("${{ needs.build.outputs.digest }}");
    expect(job.secrets).toBe("inherit");
  });

  test("the concurrency group is release and never cancels a publish", () => {
    expect(release.concurrency).toEqual({ group: "release", "cancel-in-progress": false });
  });

  test("the summary names the toon-household path", () => {
    expect(RELEASE_SRC).toContain("cd /opt/toon-household && docker compose pull && docker compose up -d --remove-orphans");
  });
});

describe("deploy.yml", () => {
  test("triggers: workflow_call with an optional digest, and a manual dispatch with the same input", () => {
    expect(Object.keys(deploy.on).sort()).toEqual(["workflow_call", "workflow_dispatch"]);
    for (const key of ["workflow_call", "workflow_dispatch"] as const) {
      const input = inputOf(deploy, key, "image_digest");
      expect(input.type).toBe("string");
      expect(input.required).toBe(false);
      expect(input.default).toBe("");
    }
  });

  test("the concurrency group is deploy-toon-household and never cancels a deploy", () => {
    expect(deploy.concurrency).toEqual({ group: "deploy-toon-household", "cancel-in-progress": false });
  });

  test("the production environment carries the TOON_HOSTNAME link", () => {
    expect(jobOf(deploy, "deploy").environment).toEqual({ name: "production", url: "https://${{ vars.TOON_HOSTNAME }}" });
  });

  test("the forced command is toon-household-deploy and the ssh remote request is deploy <ref>", () => {
    expect(DEPLOY_SRC).toContain("/usr/local/bin/toon-household-deploy");
    expect(DEPLOY_SRC).toContain('"$USER@$HOST" "deploy $REF"');
  });

  test("the digest is validated in the workflow, the copy that makes a readable error", () => {
    expect(DEPLOY_SRC).toContain("grep -Eq '^sha256:[0-9a-f]{64}$'");
    expect(DEPLOY_SRC).toContain('echo "::error::Not a valid digest: $DIGEST"');
  });

  test("an empty known_hosts secret fails with the translated ssh-keyscan hint", () => {
    expect(DEPLOY_SRC).toContain(
      "echo \"::error::DEPLOY_SSH_KNOWN_HOSTS is empty. On the server run: ssh-keyscan -p <port> <host>\"",
    );
  });

  test("the workflow_dispatch description is the translated English text", () => {
    expect(inputOf(deploy, "workflow_dispatch", "image_digest").description).toBe("Image digest (sha256:…) or empty for :latest");
  });
});

describe("ci.yml docker-build job", () => {
  test("it runs on pull_request only, builds amd64 and does not push", () => {
    const job = jobOf(ci, "docker-build");
    expect(job).toBeDefined();
    expect(job.if).toBe("github.event_name == 'pull_request'");
    const build = (job.steps ?? []).find((s) => s.name === "Build (amd64, no push)");
    expect(build?.with?.platforms).toBe("linux/amd64");
    expect(build?.with?.push).toBe(false);
  });

  test("it passes the same build args as the release", () => {
    const build = (jobOf(ci, "docker-build").steps ?? []).find((s) => s.name === "Build (amd64, no push)");
    expect(String(build?.with?.["build-args"]).split("\n").map((l) => l.trim()).filter(Boolean)).toEqual(["WITH_OCR=1", "WITH_PDF=0"]);
  });

  test("the verify job is still there and still runs the poppler step before the tests", () => {
    expect(Object.keys(ci.jobs)).toEqual(["verify", "docker-build"]);
    const steps = jobOf(ci, "verify").steps ?? [];
    const poppler = steps.findIndex((s) => s.name === "Install poppler");
    const test_ = steps.findIndex((s) => s.run === "bun test");
    expect(poppler).toBeGreaterThanOrEqual(0);
    expect(poppler).toBeLessThan(test_);
  });
});

describe("the three files carry no toon-finance or toon-recipe deploy target", () => {
  for (const [name, src] of [
    ["release.yml", RELEASE_SRC],
    ["deploy.yml", DEPLOY_SRC],
    ["ci.yml", CI_SRC],
  ] as const) {
    test(`${name} names no toon-finance-deploy, /opt/toon-finance or /opt/toon-recipe`, () => {
      expect(src).not.toContain("toon-finance-deploy");
      expect(src).not.toContain("/opt/toon-finance");
      expect(src).not.toContain("/opt/toon-recipe");
    });
  }
});

describe("the three files are English (plan decision 2)", () => {
  for (const [name, src] of [
    ["release.yml", RELEASE_SRC],
    ["deploy.yml", DEPLOY_SRC],
    ["ci.yml", CI_SRC],
  ] as const) {
    test(`${name} has no umlaut or sharp s`, () => {
      expect(src).not.toMatch(/[äöüßÄÖÜ]/);
    });

    test(`${name} has none of the German phrases of the source`, () => {
      for (const phrase of GERMAN_PHRASES) expect(src).not.toContain(phrase);
    });
  }
});
