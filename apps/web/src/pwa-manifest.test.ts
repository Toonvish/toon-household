import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { PWA_MANIFEST } from "../pwa-manifest.ts";
import { THEME_COLORS } from "./lib/theme-colors";

const publicDir = new URL("../public", import.meta.url).pathname;

function pngSize(src: string): { width: number; height: number } {
  const path = publicDir + src;
  expect(existsSync(path)).toBe(true);
  const bytes = readFileSync(path);
  // PNG signature, then the IHDR chunk: width and height are big-endian u32 at bytes 16-23.
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function expectSize(icon: { src: string; sizes: string }) {
  const { width, height } = pngSize(icon.src);
  expect(`${width}x${height}`).toBe(icon.sizes);
}

describe("PWA manifest", () => {
  test("names, description and colours", () => {
    expect(PWA_MANIFEST.name).toBe("Haushalt");
    expect(PWA_MANIFEST.short_name).toBe("Haushalt");
    expect(PWA_MANIFEST.description).toBe("Rezepte, Einkauf und Haushaltskasse für deinen Haushalt.");
    expect(PWA_MANIFEST.theme_color).toBe(THEME_COLORS.light);
    expect(PWA_MANIFEST.background_color).toBe(THEME_COLORS.light);
  });

  test("the three shortcuts, exactly", () => {
    expect(PWA_MANIFEST.shortcuts.map((s) => [s.name, s.short_name, s.url])).toEqual([
      ["Rezept importieren", "Importieren", "/recipe/import"],
      ["Neues Rezept", "Neu", "/recipe/recipes/new"],
      ["Buchung erfassen", "Erfassen", "/finance/new"],
    ]);
  });

  test("every icon and shortcut icon exists at its declared size", () => {
    for (const icon of PWA_MANIFEST.icons) expectSize(icon);
    for (const shortcut of PWA_MANIFEST.shortcuts) {
      expect(shortcut.icons.length).toBeGreaterThan(0);
      for (const icon of shortcut.icons) expectSize(icon);
    }
  });

  test("a maskable pair exists", () => {
    const sizes = PWA_MANIFEST.icons
      .filter((i) => i.purpose === "maskable")
      .map((i) => i.sizes)
      .sort();
    expect(sizes).toEqual(["192x192", "512x512"]);
  });

  test("the apple-touch and favicon PNGs exist at their sizes", () => {
    expectSize({ src: "/icons/apple-touch-icon.png", sizes: "180x180" });
    expectSize({ src: "/icons/favicon-32.png", sizes: "32x32" });
  });
});
