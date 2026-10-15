// Guards of the operator guide docs/migration.md (M5-T10 step 6, M3b-T09 claim links).
// docs/migration.md step 6 copies the migrated database and uploads into a pre-filled named volume
// as root. Docker only seeds ownership from the image when a volume is empty at first mount, so the
// copy must hand the files to the app user (`bun`, uid 1000) or the new stack cannot write them.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOC = readFileSync(join(import.meta.dir, "../../../docs/migration.md"), "utf8");

describe("docs/migration.md cutover step 6", () => {
  const start = DOC.indexOf("6. **Copy the result into the new stack's volume**");
  const end = DOC.indexOf("7. **Start the new stack**");
  const step = DOC.slice(start, end);

  test("the step is found", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  test("the copy command ends with a chown to the bun uid over the whole volume", () => {
    const command = step.slice(step.indexOf("docker run"), step.indexOf("```", step.indexOf("docker run")));
    expect(command).toContain("cp /in/toon.db /data/local.db");
    expect(command).toContain("cp -a /in/uploads /data/uploads");
    expect(command).toMatch(/&& chown -R 1000:1000 \/data'/);
    // the chown runs after every copy
    expect(command.lastIndexOf("chown")).toBeGreaterThan(command.lastIndexOf("cp "));
  });

  test("the step explains why", () => {
    expect(step).toContain("USER bun");
    expect(step).toContain("pre-filled");
  });
});

// Plan m3b decision 14 (ADR 0006): the claim links of migrated placeholders appear only in an apply
// run, and the guide must say that the apply report is a credential kept outside any repository.
describe("docs/migration.md placeholders and claim links", () => {
  const start = DOC.indexOf("## Placeholders and claim links");
  const end = DOC.indexOf("## Preparing the inputs");
  const section = DOC.slice(start, end);

  test("the section exists before Preparing the inputs", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  test("the apply report is a credential that stays outside any repository", () => {
    expect(section).toContain("The apply report is a credential");
    expect(section).toContain("outside any repository");
    expect(section).toContain("never\n  commit it");
  });

  test("the link appears only in --apply, is re-printed by a second --apply and uses WEB_ORIGIN", () => {
    expect(section).toContain("== Placeholders and claim invites ==");
    expect(section).toContain("only by\n  `--apply`");
    expect(section).toContain("A dry run\n  (alone or as the first pass of `--apply`) never prints a link.");
    expect(section).toContain("**Printing a link again.** Run the same `--apply` command again.");
    expect(section).toContain("`WEB_ORIGIN`");
  });

  test("no apply report is written into the repository by the documented commands", () => {
    expect(DOC).not.toContain("--report migration-out/apply.json");
    expect(DOC.match(/--apply --report "\$PRIVATE_DIR\/apply\.json"/g)).toHaveLength(2);
  });

  test("the report table lists the section and the finance schema gate is three migrations", () => {
    expect(DOC).toContain("| `== Placeholders and claim invites ==` |");
    expect(DOC).toContain("toon-finance: 3 migrations, last\n`0002_placeholder_members`");
  });
});
