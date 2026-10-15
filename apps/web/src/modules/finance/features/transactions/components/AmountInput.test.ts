/**
 * Guard for the M4 review finding "the € sign overlaps the amount in AmountInput": the glyph is
 * absolutely positioned over a right-aligned input, so the input must reserve the glyph's width
 * on the right (`pr-*` at least as wide as the glyph's offset plus its width) and the glyph must be
 * centred by a flex box (an `absolute inset-y-0 my-auto` span has no height and sticks to the top).
 * There is no DOM in `bun test`, so this reads the source; the headless run measures the real boxes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "AmountInput.tsx"), "utf8");

/** Tailwind spacing steps are quarter-rems: `pr-12` = 3rem, `right-4` = 1rem. */
function step(utility: string, text: string): number {
  const match = text.match(new RegExp(`(?:^|[\\s"])${utility}-(\\d+)(?=[\\s"])`));
  if (!match) throw new Error(`no ${utility}-N utility found`);
  return Number(match[1]) / 4;
}

describe("AmountInput currency glyph", () => {
  const input = source.match(/<input[\s\S]*?\/>/)?.[0] ?? "";
  const glyph = source.match(/<span aria-hidden="true"[^>]*data-amount-currency[^>]*>/)?.[0] ?? "";
  // text-display-lg is 1.5rem; the euro sign is at most one em wide.
  const glyphWidthRem = 1.5;

  test("finds the input and the glyph", () => {
    expect(input).not.toBe("");
    expect(glyph).not.toBe("");
  });

  test("the input reserves a right gutter wider than the glyph's offset plus its width", () => {
    expect(step("pr", input)).toBeGreaterThanOrEqual(step("right", glyph) + glyphWidthRem);
  });

  test("the input no longer uses the symmetric px-4 that lets the digits run under the glyph", () => {
    expect(input).not.toMatch(/[\s"]px-\d+[\s"]/);
  });

  test("the glyph is centred by a flex box, not by my-auto", () => {
    expect(glyph).toContain("flex items-center");
    expect(glyph).not.toContain("my-auto");
    expect(glyph).toContain("inset-y-0");
  });
});

describe("AmountInput buffer and focus (M3b-T03, toon-finance gotchas 58 and 59)", () => {
  test("the input carries data-autofocus when autoFocus is set, so the Dialog finds it before the close button", () => {
    expect(source).toContain('data-autofocus={autoFocus ? "" : undefined}');
  });

  test("the text buffer follows a change from outside, compared against the last value it emitted itself", () => {
    expect(source).toContain("const [emitted, setEmitted] = useState<number | null>(valueCents);");
    expect(source).toMatch(/if \(valueCents !== emitted\) \{\s*setEmitted\(valueCents\);\s*setText\(/);
  });

  test("typing records what it emitted, so a parse of '12,' is not rewritten to '12,00'", () => {
    const commit = source.match(/function commit\([\s\S]*?\n  \}\n/)?.[0] ?? "";
    expect(commit).toContain("setEmitted(cents);");
    expect(commit.indexOf("setEmitted(cents);")).toBeLessThan(commit.indexOf("onChange(cents);"));
  });
});
