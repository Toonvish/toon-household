/**
 * Guard for the print stylesheet (plan m4-design-pass decision 14, M4-T09): the phone detail keeps
 * its Ingredients and Method panels in the DOM under the `hidden` attribute, and print.css must
 * reveal both. The shell's `[hidden]{display:none!important}` lives in `@layer base`, and for
 * `!important` declarations an unlayered rule LOSES to a layered one, so the override has to sit in
 * `@layer base` itself. Printing a recipe to PDF from a 390 px window is the real check (this test
 * only keeps the one-line cause from coming back); there is no DOM in `bun test`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "print.css"), "utf8");
const index = readFileSync(join(import.meta.dir, "../../../../styles/index.css"), "utf8");

describe("print.css [hidden] override", () => {
  test("the shell's [hidden] reset is layered and important", () => {
    expect(index).toMatch(/@layer base \{[\s\S]*\[hidden\] \{\s*display: none !important;/);
  });

  test("the print override sits in @layer base and targets the panels directly", () => {
    expect(css).toMatch(/@layer base \{\s*\.recipe-print > \[hidden\] \{\s*display: flex !important;/);
  });

  test("no unlayered `.recipe-print [hidden]` rule is left (it would lose the cascade)", () => {
    expect(css).not.toMatch(/^\s{2}\.recipe-print \[hidden\]/m);
  });
});
