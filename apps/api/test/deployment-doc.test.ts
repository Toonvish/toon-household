/**
 * Guards of docs/deployment.md (SPEC D11, D15; M6-T06). The doc is read, never executed: these
 * tests fail when a section, a command or a name that an operator copies disappears, and above all
 * when a destructive command could be copy-pasted against the production volume.
 *
 * T07 adds a second describe block for the cutover section it inserts between "## Operations" and
 * "## Variants"; this first block checks the H2 order as a subsequence for that reason.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

  test("the H2 sections exist in order (as a subsequence: T07 inserts the cutover)", () => {
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

  test("the T07 placeholder sits between Operations and Variants (until T07 replaces it)", () => {
    const placeholder = DOC_LINES.indexOf("<!-- T07: Cutover from toon-edge -->");
    const cutover = DOC_LINES.indexOf("## Cutover from toon-edge");
    const operations = DOC_LINES.indexOf("## Operations");
    const variants = DOC_LINES.indexOf("## Variants");
    const where = placeholder === -1 ? cutover : placeholder;
    expect(where).toBeGreaterThan(operations);
    expect(where).toBeLessThan(variants);
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
