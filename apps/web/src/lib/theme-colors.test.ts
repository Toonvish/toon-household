import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { THEME_COLORS } from "./theme-colors";

const css = readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

/** Palette entries declared in the first `:root` block. */
function palette(): Map<string, string> {
  const root = css.slice(css.indexOf(":root {"));
  const end = root.indexOf("\n}");
  const map = new Map<string, string>();
  for (const m of root.slice(0, end).matchAll(/(--toon-[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    map.set(m[1]!, m[2]!.toLowerCase());
  }
  return map;
}

/**
 * Body of the theme block whose header is `header` at the start of a line (comments that quote
 * a selector do not start a line with it). The media block's inner `:root` is indented, so its
 * body ends at the first "\n  }" and top-level blocks at the first "\n}".
 */
function blockAfter(header: string): { body: string } {
  const start = css.search(new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
  if (start < 0) throw new Error(`block not found: ${header}`);
  const open = css.indexOf("{", start);
  const nested = header.startsWith("@media");
  const innerOpen = nested ? css.indexOf("{", open + 1) : open;
  const close = css.indexOf(nested ? "\n  }" : "\n}", innerOpen);
  return { body: css.slice(innerOpen + 1, close) };
}

function resolveBg(body: string): string {
  const m = body.match(/--bg:\s*([^;]+);/);
  if (!m) throw new Error("no --bg in block");
  const value = m[1]!.trim();
  const ref = value.match(/^var\((--toon-[\w-]+)\)$/);
  if (!ref) return value.toLowerCase();
  const resolved = palette().get(ref[1]!);
  if (!resolved) throw new Error(`unresolved ${ref[1]}`);
  return resolved;
}

describe("THEME_COLORS agrees with theme.css, index.html", () => {
  test("--bg in the four theme blocks", () => {
    const rootLight = resolveBg(blockAfter(":root {").body);
    const mediaDark = resolveBg(blockAfter("@media (prefers-color-scheme: dark)").body);
    const forcedLight = resolveBg(blockAfter(':root[data-theme="light"]').body);
    const forcedDark = resolveBg(blockAfter(':root[data-theme="dark"]').body);
    expect(rootLight).toBe(THEME_COLORS.light);
    expect(forcedLight).toBe(THEME_COLORS.light);
    expect(mediaDark).toBe(THEME_COLORS.dark);
    expect(forcedDark).toBe(THEME_COLORS.dark);
  });

  test("index.html inline script holds both hexes and the meta defaults to light", () => {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(script).toContain(`"${THEME_COLORS.light}"`);
    expect(script).toContain(`"${THEME_COLORS.dark}"`);
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLORS.light}" />`);
  });

  test("the colours are the sand palette ends", () => {
    expect(THEME_COLORS).toEqual({ light: "#faf5ee", dark: "#17120f" });
  });
});
