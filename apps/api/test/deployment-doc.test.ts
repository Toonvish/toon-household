/**
 * Guards of docs/deployment.md (SPEC D11, D15; M6-T06). The doc is read, never executed: these
 * tests fail when a section, a command or a name that an operator copies disappears, and above all
 * when a destructive command could be copy-pasted against the production volume.
 *
 * The cutover section (M6-T07) sits between "## Operations" and "## Variants"; the first block checks
 * the H2 order as a subsequence for that reason, the later blocks guard the cutover and the cutover
 * order of docs/migration.md.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const DOC = readFileSync(join(ROOT, "docs/deployment.md"), "utf8");
const LOCAL_ENV = readFileSync(join(ROOT, ".env.local-stack"), "utf8");
const DOC_LINES = DOC.split("\n");

const PROJECT_FLAG = "-p toon-household-local";

/** The H2 headings of the doc, in order (fenced code is skipped: a `## ` there is a shell comment). */
function h2Headings(): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of DOC_LINES) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && line.startsWith("## ")) out.push(line);
  }
  return out;
}

/** The text of one H2 section: from its heading to the next H2 (or the end). */
function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const next = DOC.indexOf("\n## ", start + heading.length + 2);
  return DOC.slice(start, next === -1 ? undefined : next);
}

/** 1-based line range [first, last] of an H2 section. */
function sectionLines(heading: string): [number, number] {
  const first = DOC_LINES.indexOf(heading) + 1;
  expect(first).toBeGreaterThan(0);
  let last = DOC_LINES.length;
  for (let i = first; i < DOC_LINES.length; i += 1) {
    if (DOC_LINES[i]?.startsWith("## ")) {
      last = i; // the line before the next heading, 1-based
      break;
    }
  }
  return [first, last];
}

describe("docs/deployment.md", () => {
  test("is English: no German article words outside quoted UI labels", () => {
    // The only German in the doc is quoted UI copy ("Aktivieren", "Neue Version verfügbar").
    const prose = DOC.replace(/`[^`]*`/g, "").replace(/"[^"\n]*"/g, "");
    expect(prose).not.toMatch(/\b(und|oder|nicht|Schritt|Voraussetzungen|Fehlersuche|Betrieb)\b/);
  });

  test("the H2 sections exist in order (as a subsequence: the cutover sits inside)", () => {
    const expected = [
      "## What runs",
      "## Prerequisites",
      "## Fresh install",
      "## Operations",
      "## Variants",
      "## Local stack test",
      "## Troubleshooting",
      "## What is deliberately missing",
    ];
    const actual = h2Headings();
    let at = -1;
    for (const heading of expected) {
      const found = actual.indexOf(heading, at + 1);
      expect(found, `${heading} missing or out of order in ${JSON.stringify(actual)}`).toBeGreaterThan(at);
      at = found;
    }
  });

  test("the cutover section sits between Operations and Variants and no placeholder is left", () => {
    expect(DOC).not.toContain("<!-- T07");
    const cutover = DOC_LINES.indexOf("## Cutover from toon-edge");
    expect(cutover).toBeGreaterThan(DOC_LINES.indexOf("## Operations"));
    expect(cutover).toBeLessThan(DOC_LINES.indexOf("## Variants"));
  });

  test("names the artefacts an operator needs", () => {
    for (const name of [
      "toon-household_toon-data",
      "/opt/toon-household",
      "toon-household-deploy",
      "ghcr.io/toonvish/toon-household",
      "DEPLOY_ENABLED",
      "ALLOW_SEED=1",
    ]) {
      expect(DOC, name).toContain(name);
    }
  });

  test("links docs/migration.md and does not restate its report", () => {
    expect(DOC).toContain("(migration.md)");
    expect(DOC).not.toContain("legacy_ids");
  });

  test("the install steps cover the files T01 to T05 produced", () => {
    const fresh = section("## Fresh install");
    for (const part of [
      "docker/Caddyfile",
      "docker/env.example",
      "docker-compose.yml",
      "dig +short <hostname>",
      "ufw allow 443/udp",
      "restrict,command=\"/usr/local/bin/toon-household-deploy\"",
      "DEPLOY_SSH_KNOWN_HOSTS",
      "production",
      "sync-config",
    ]) {
      expect(fresh, part).toContain(part);
    }
  });
});

describe("docs/deployment.md local stack test", () => {
  const local = () => section("## Local stack test");

  test("builds the image, starts and stops the stack as its own project", () => {
    const text = local();
    expect(text).toContain("docker build -t toon-household:local .");
    expect(text).toContain("> build.log 2>&1");
    expect(text).toContain(`${PROJECT_FLAG} --env-file .env.local-stack up -d`);
    expect(text).toContain("toon-household-local");
    expect(text).toContain("down -v");
    for (const host of ["haushalt.test", "rezepte.test", "finanzen.test"]) expect(text).toContain(host);
    expect(text).toContain("/toon-root-ca.crt");
    expect(text).toContain("/api/health");
  });

  test("says it is never run in /opt/toon-household", () => {
    expect(local()).toMatch(/never run this in\s+`\/opt\/toon-household`/i);
  });

  test("every `down -v` line of the WHOLE doc lies in Local stack test and carries -p toon-household-local", () => {
    const [first, last] = sectionLines("## Local stack test");
    const hits = DOC_LINES.map((text, i) => ({ text, n: i + 1 })).filter((l) => l.text.includes("down -v"));
    expect(hits.length).toBeGreaterThan(0);
    for (const { text, n } of hits) {
      expect(n >= first && n <= last, `line ${n} has "down -v" outside Local stack test: ${text}`).toBe(true);
      expect(text, `line ${n} has "down -v" without ${PROJECT_FLAG}`).toContain(PROJECT_FLAG);
    }
  });

  test("every docker compose line that uses .env.local-stack carries -p toon-household-local", () => {
    const hits = DOC_LINES.map((text, i) => ({ text, n: i + 1 })).filter(
      (l) => l.text.includes(".env.local-stack") && l.text.includes("docker compose"),
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const { text, n } of hits) {
      expect(text, `line ${n} uses .env.local-stack without ${PROJECT_FLAG}`).toContain(PROJECT_FLAG);
    }
  });

  test("no docker compose command in the doc deletes volumes except in Local stack test (down alone is fine)", () => {
    const [first, last] = sectionLines("## Local stack test");
    for (const [i, text] of DOC_LINES.entries()) {
      if (i + 1 >= first && i + 1 <= last) continue;
      if (!/docker compose.*\b(down|rm)\b/.test(text)) continue;
      expect(text, `line ${i + 1}`).not.toMatch(/(--volumes|\s-v\b)/);
    }
  });

  test(".env.local-stack sets COMPOSE_PROJECT_NAME=toon-household-local", () => {
    expect(LOCAL_ENV.split("\n")).toContain("COMPOSE_PROJECT_NAME=toon-household-local");
  });

  test("the production .env template never sets COMPOSE_PROJECT_NAME", () => {
    const template = readFileSync(join(ROOT, "docker/env.example"), "utf8");
    expect(template).not.toMatch(/^\s*COMPOSE_PROJECT_NAME=/m);
  });
});

describe("docs/deployment.md cutover from toon-edge", () => {
  const STEP_TITLES = [
    "Before the day",
    "Prepare the new stack without starting it",
    "Stop the old stacks, without",
    "Copy the old volumes out",
    "Dry run and read the report",
    "Apply, then apply again",
    "Copy the result into `toon-household_toon-data`",
    "Start the new stack",
    "Verify",
    "Switch deploys over",
    "Retire the old stacks and toon-edge",
    "Later: drop the redirects",
    "Last: delete the old volumes",
  ];
  const cutover = () => section("## Cutover from toon-edge");

  /** The text of step n: from its "n. **Title" line to the next step (or "Rolling back"). */
  function step(n: number): string {
    const text = cutover();
    const start = text.search(new RegExp(`^${n}\\. \\*\\*`, "m"));
    expect(start, `step ${n} missing`).toBeGreaterThan(-1);
    const rest = text.slice(start + 1);
    const next = rest.search(new RegExp(`^(${n + 1}\\. \\*\\*|\\*\\*Rolling back)`, "m"));
    return text.slice(start, next === -1 ? undefined : start + 1 + next);
  }

  test("the bold step titles 0 to 12 appear in order, then Rolling back", () => {
    const text = cutover();
    let at = -1;
    for (const [n, title] of STEP_TITLES.entries()) {
      const marker = `\n${n}. **${title}`;
      const found = text.indexOf(marker);
      expect(found, `step ${n} "${title}" missing`).toBeGreaterThan(-1);
      expect(found, `step ${n} out of order`).toBeGreaterThan(at);
      at = found;
    }
    expect(text.indexOf("**Rolling back.**")).toBeGreaterThan(at);
  });

  test("step 2 stops the three old stacks with docker compose down and never with -v", () => {
    const body = step(2);
    for (const dir of ["/opt/toon-recipe", "/opt/toon-finance", "/opt/toon-edge"]) {
      expect(body, dir).toContain(`cd ${dir}`);
    }
    const commands = body.split("\n").filter((l) => l.includes("docker compose"));
    expect(commands.filter((l) => l.includes("docker compose down"))).toHaveLength(3);
    for (const line of commands) {
      expect(line, line).not.toMatch(/(--volumes|\s-v\b)/);
    }
  });

  test("no docker volume rm and no volume deletion before step 12", () => {
    const text = cutover();
    const step12 = text.search(/^12\. \*\*/m);
    expect(step12).toBeGreaterThan(-1);
    const before = text.slice(0, step12);
    expect(before).not.toContain("docker volume rm");
    expect(before).not.toMatch(/docker volume prune|docker system prune/);
    expect(step(12)).toContain("docker volume rm toon-recipe_toon-data toon-finance_toon-data");
    // and none anywhere else in the doc outside this step, the closing paragraph aside
    const withRm = DOC_LINES.filter((l) => l.includes("docker volume rm"));
    expect(withRm.length).toBeGreaterThan(0);
    for (const line of withRm) expect(step(12), line).toContain(line);
  });

  test("step 6 copies into toon-household_toon-data and chowns to the Dockerfile's bun uid", () => {
    const body = step(6);
    expect(body).toContain("docker volume create toon-household_toon-data");
    expect(body).toContain("-v toon-household_toon-data:/data");
    expect(body).toContain("cp /in/toon.db /data/local.db");
    expect(body).toContain("cp -a /in/uploads /data/uploads");
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/USER bun/);
    const uid = /uid (\d+)/.exec(dockerfile.slice(dockerfile.indexOf("`bun` is the unprivileged user")))?.[1];
    expect(uid).toBe("1000");
    expect(body).toContain(`chown -R ${uid}:${uid} /data`);
    // the chown comes after every copy
    expect(body.lastIndexOf("chown")).toBeGreaterThan(body.lastIndexOf("cp -a"));
    // the step's command is the one of migration.md step 6, with the real name
    const migration = readFileSync(join(ROOT, "docs/migration.md"), "utf8");
    const line = (text: string) => text.split("\n").find((l) => l.includes("cp /in/toon.db /data/local.db"));
    expect(line(body)?.trim()).toBe(line(migration)?.trim());
  });

  test("step 4 runs the migration from the image as uid 1000 and links the report", () => {
    const body = step(4);
    expect(body).toContain("--user 1000:1000");
    expect(body).toContain("ghcr.io/toonvish/toon-household");
    expect(body).toContain("apps/api/scripts/migrate-legacy.ts");
    expect(body).toContain("migration.md#the-report");
  });

  test("step 8 checks both old hostnames, the retiring worker and the health route", () => {
    const body = step(8);
    expect(body).toContain("<old-recipe-hostname>");
    expect(body).toContain("<old-finance-hostname>");
    expect(body).toContain("/sw.js");
    expect(body).toContain("/api/health");
    expect(body).toContain("https://<new-hostname>/recipe/plan");
    expect(body).toContain("https://<new-hostname>/finance/plan");
    expect(body).toContain("ADR 0008");
  });

  test("step 1 does not start the stack and sets both old hostnames", () => {
    const body = step(1);
    expect(body).toContain("RECIPE_HOSTNAME");
    expect(body).toContain("FINANCE_HOSTNAME");
    expect(body).toContain("Do NOT run `docker compose up`");
    expect(body.split("\n").filter((l) => /^\s+docker compose up/.test(l))).toHaveLength(0);
    expect(body).toContain("--entrypoint caddy caddy");
    expect(body).toContain("validate --config /etc/caddy/Caddyfile");
  });

  test("links migration.md and the ADR, names the volumes and the hostnames", () => {
    const text = cutover();
    expect(text).toContain("(migration.md");
    expect(text).toContain("migration.md#cutover-order");
    expect(text).toMatch(/\(adr\/0008-[a-z-]+\.md\)/);
    for (const name of [
      "toon-household_toon-data",
      "toon-recipe_toon-data",
      "toon-finance_toon-data",
      "toon-edge_caddy-data",
      "RECIPE_HOSTNAME",
      "FINANCE_HOSTNAME",
      "/sw.js",
      "/opt/toon-household",
      "toon-household-deploy",
    ]) {
      expect(text, name).toContain(name);
    }
    // every relative markdown link of the section points at a file that exists
    for (const [, target] of text.matchAll(/\]\((?!https?:|#)([^)#]+)(?:#[^)]*)?\)/g)) {
      expect(existsSync(join(ROOT, "docs", target as string)), `broken link ${target}`).toBe(true);
    }
  });

  test("the in-page anchors of the section exist as headings of the doc", () => {
    const anchors = DOC_LINES.filter((l) => /^#{2,3} /.test(l)).map((l) =>
      l.replace(/^#+ /, "").toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-"),
    );
    for (const [, anchor] of cutover().matchAll(/\]\(#([^)]+)\)/g)) {
      expect(anchors, `#${anchor}`).toContain(anchor as string);
    }
  });
});

describe("docs/migration.md cutover order after M6", () => {
  const MIGRATION = readFileSync(join(ROOT, "docs/migration.md"), "utf8");
  const order = MIGRATION.slice(MIGRATION.indexOf("## Cutover order"));
  const step8 = order.slice(order.indexOf("8. **Verify.**"), order.indexOf("9. **Retire the old stacks.**"));

  test("no placeholder volume name is left anywhere", () => {
    expect(MIGRATION).not.toContain("<new-volume>");
    expect(order).toContain("toon-household_toon-data");
  });

  test("step 8 expects the path-by-path Locations of ADR 0008 and checks /sw.js", () => {
    expect(step8.length).toBeGreaterThan(0);
    expect(step8).toContain("Location: https://<new-hostname>/recipe");
    expect(step8).toContain("Location: https://<new-hostname>/finance");
    expect(step8).toContain("/sw.js");
    expect(step8).toContain("(ADR 0008)");
    expect(step8).toContain("deployment.md#cutover-from-toon-edge");
    expect(MIGRATION.split("\n").filter((l) => /Location: https:\/\/<new-hostname>\/\s*$/.test(l))).toEqual([]);
  });

  test("the intro states the real names and links the deployment cutover; step 7 names the directory", () => {
    const intro = order.slice(0, order.indexOf("1. **Stop both old stacks"));
    expect(intro).toContain("ghcr.io/toonvish/toon-household");
    expect(intro).toContain("/app/data/local.db");
    expect(intro).toContain("deployment.md#cutover-from-toon-edge");
    const step7 = order.slice(order.indexOf("7. **Start the new stack**"), order.indexOf("8. **Verify.**"));
    expect(step7).toContain("/opt/toon-household");
  });
});
