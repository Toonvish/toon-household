/** `hasAtLeast` — the client-side role check (owner satisfies admin; unknown is false). */
import { describe, expect, test } from "bun:test";
import { hasAtLeast } from "./permissions";

describe("hasAtLeast", () => {
  test("an unknown role is never enough", () => {
    expect(hasAtLeast(undefined, "member")).toBe(false);
    expect(hasAtLeast(null, "member")).toBe(false);
  });

  test("equal roles satisfy each other", () => {
    expect(hasAtLeast("admin", "admin")).toBe(true);
  });

  test("a lower role does not satisfy a higher requirement", () => {
    expect(hasAtLeast("member", "admin")).toBe(false);
  });

  test("owner satisfies admin", () => {
    expect(hasAtLeast("owner", "admin")).toBe(true);
  });
});
