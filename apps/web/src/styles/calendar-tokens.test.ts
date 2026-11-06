// The calendar's eleven tokens (plan m8 P29, ADR 0016, design §4.6): defined in all four theme.css blocks (the
// override set grows from 39 to 50), mapped in index.css `@theme inline` so `bg-waste-*` and `bg-person-*` exist,
// and each at least 3:1 against `--surface` of the same scheme (WCAG 2 relative luminance on the hex values), so a
// dot reads on a card in light and dark.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES = import.meta.dir;
const THEME = readFileSync(join(STYLES, "theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const INDEX = readFileSync(join(STYLES, "index.css"), "utf8");

const CALENDAR_TOKENS = [
  "--waste-rest",
  "--waste-yellow",
  "--waste-bio",
  "--waste-paper",
  "--waste-tree",
  "--person-1",
  "--person-2",
  "--person-3",
  "--person-4",
  "--person-5",
  "--person-6",
] as const;

/** The four top-level blocks by their head, as the design-system test splits them. */
function blocks(css: string): Map<string, string> {
  const result = new Map<string, string>();
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const block = css.slice(start, i + 1).trim();
        result.set(block.slice(0, block.indexOf("{")).trim(), block);
        start = i + 1;
      }
    }
  }
  return result;
}

function declarations(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1]!, m[2]!.trim()]));
}

const all = blocks(THEME);
const root = declarations(all.get(":root") ?? "");
const media = declarations(all.get("@media (prefers-color-scheme: dark)") ?? "");
const light = declarations(all.get(':root[data-theme="light"]') ?? "");
const dark = declarations(all.get(':root[data-theme="dark"]') ?? "");

/** WCAG 2 relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("the calendar tokens (ADR 0016)", () => {
  test("all four blocks exist", () => {
    expect([root, media, light, dark].map((block) => block.size > 0)).toEqual([true, true, true, true]);
  });

  test("every token is defined in every block as a #rrggbb literal", () => {
    for (const [name, block] of Object.entries({ root, media, light, dark })) {
      for (const token of CALENDAR_TOKENS) {
        expect(block.get(token), `${name} ${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  test("the override set is 50: the design pass's 39 plus the eleven", () => {
    expect(media.size).toBe(50);
    expect(light.size).toBe(50);
    expect(dark.size).toBe(50);
  });

  test("light equals :root and the explicit light block; dark equals the media block and the explicit dark block", () => {
    for (const token of CALENDAR_TOKENS) {
      expect(light.get(token), token).toBe(root.get(token)!);
      expect(dark.get(token), token).toBe(media.get(token)!);
      expect(media.get(token), `${token} differs between light and dark`).not.toBe(root.get(token)!);
    }
  });

  test("each token is at least 3:1 against --surface of its scheme", () => {
    const failures: string[] = [];
    for (const [scheme, block, surface] of [
      ["light", root, root.get("--surface")!],
      ["dark", media, media.get("--surface")!],
    ] as const) {
      expect(surface, scheme).toMatch(/^#[0-9a-f]{6}$/);
      for (const token of CALENDAR_TOKENS) {
        const ratio = contrast(block.get(token)!, surface);
        if (ratio < 3) failures.push(`${scheme} ${token} ${block.get(token)} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("index.css maps every token to a --color-* utility (bg-waste-rest, bg-person-1, ...)", () => {
    for (const token of CALENDAR_TOKENS) {
      expect(INDEX, token).toContain(`--color-${token.slice(2)}: var(${token});`);
    }
  });
});
