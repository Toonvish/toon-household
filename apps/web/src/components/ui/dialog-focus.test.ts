/**
 * Guard for toon-finance gotchas 58 and 63 (at 1715207) in the shared `Dialog`: `[data-autofocus]`
 * is queried on its OWN before the generic selector (a combined selector returns the first element in
 * document order that matches ANY branch, which is the header's close button), and the focus effect
 * runs after every render with two refs so a target that arrives later still wins, at most twice.
 * There is no DOM in `bun test`, so this reads the source.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "Dialog.tsx"), "utf8");
const code = source
  .split("\n")
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  .join("\n");

describe("Dialog initial focus", () => {
  test("queries [data-autofocus] in its own querySelector call", () => {
    expect(code).toMatch(/querySelector<HTMLElement>\("\[data-autofocus\]"\)/);
  });

  test("no selector string combines [data-autofocus] with other branches", () => {
    expect(code).not.toMatch(/"\[data-autofocus\],/);
  });

  test("the generic fallback selector comes after the [data-autofocus] query", () => {
    const own = code.indexOf('querySelector<HTMLElement>("[data-autofocus]")');
    const generic = code.indexOf("input:not([type=hidden]), textarea, select, button");
    expect(own).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(own);
  });

  test("the focus effect has no dependency array (runs after every render) and uses two refs", () => {
    expect(code).toContain("const autofocusDone = useRef(false);");
    expect(code).toContain("const fallbackDone = useRef(false);");
    // The effect closes with `});`, a dependency array would close with `}, [`.
    const effect = code.slice(code.indexOf("const fallbackDone"), code.indexOf("// Escape + a minimal focus trap"));
    expect(effect).toMatch(/fallback\.focus\(\{ preventScroll: true \}\);\s*\}\);/);
  });

  test("the scroll lock effect no longer moves focus", () => {
    const lock = code.slice(code.indexOf("previouslyFocused.current = document.activeElement"), code.indexOf("const autofocusDone"));
    // The only `.focus(` left in that effect is the cleanup that restores the opener's focus.
    expect(lock.match(/\.focus\(/g)?.length).toBe(1);
    expect(lock).toContain("previouslyFocused.current?.focus");
  });

  test("the refs reset when the dialog closes", () => {
    expect(code).toMatch(/if \(!open\) \{\s*autofocusDone\.current = false;\s*fallbackDone\.current = false;/);
  });
});
