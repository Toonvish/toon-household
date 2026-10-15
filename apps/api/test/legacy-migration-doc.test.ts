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
