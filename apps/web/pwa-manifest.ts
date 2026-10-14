import { THEME_COLORS } from "./src/lib/theme-colors.ts";

/**
 * The web app manifest, consumed by vite-plugin-pwa in vite.config.ts (kept free of any
 * plugin import so the test can load it under bun). SPEC D5/D9; shape from toon-recipe's
 * vite.config.ts. `theme_color` and `background_color` are the light `--bg`
 * (THEME_COLORS.light), the single source for every theme colour.
 *
 * Shortcut names are German copy taken byte-identical from the sources ("Rezept importieren",
 * "Neues Rezept" from toon-recipe; "Buchung erfassen" = transactions.new.title and "Erfassen" =
 * nav.create from toon-finance). The manifest has no locale, so they do not go through t().
 */
const SHORTCUT_ICONS = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];

export const PWA_MANIFEST = {
  id: "/",
  name: "Haushalt",
  short_name: "Haushalt",
  description: "Rezepte, Einkauf und Haushaltskasse für deinen Haushalt.",
  lang: "de",
  dir: "ltr",
  start_url: "/",
  scope: "/",
  display: "standalone",
  display_override: ["standalone", "minimal-ui"],
  orientation: "any",
  background_color: THEME_COLORS.light,
  theme_color: THEME_COLORS.light,
  categories: ["lifestyle", "productivity"],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    {
      name: "Rezept importieren",
      short_name: "Importieren",
      url: "/recipe/import",
      icons: SHORTCUT_ICONS,
    },
    {
      name: "Neues Rezept",
      short_name: "Neu",
      url: "/recipe/recipes/new",
      icons: SHORTCUT_ICONS,
    },
    {
      name: "Buchung erfassen",
      short_name: "Erfassen",
      url: "/finance/new",
      icons: SHORTCUT_ICONS,
    },
  ],
} as const;

type DeepWritable<T> = T extends readonly (infer U)[]
  ? DeepWritable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepWritable<T[K]> }
    : T;

/**
 * The same manifest typed without `readonly`: vite-plugin-pwa's `ManifestOptions` declares mutable
 * arrays, which a deeply readonly `as const` object is not assignable to. The tests read the
 * literal-typed PWA_MANIFEST; vite.config.ts passes this one.
 */
export const PWA_MANIFEST_OPTIONS = PWA_MANIFEST as unknown as DeepWritable<typeof PWA_MANIFEST>;
