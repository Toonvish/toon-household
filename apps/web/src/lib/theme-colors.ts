/**
 * The ONE source of the two theme colours (M4 plan decision 9).
 *
 * `light` is the light `--bg` (`--toon-sand-50`), `dark` the dark `--bg` (`--toon-sand-950`).
 * Four places must agree, and `theme-colors.test.ts` / `pwa-manifest.test.ts` enforce it:
 *   1. `src/styles/theme.css`: `--bg` in the four theme blocks (light/dark palette entries),
 *   2. `index.html`: the inline pre-paint script (literal hexes, it cannot import) and the
 *      `<meta name="theme-color">` default,
 *   3. `src/lib/theme.ts`: the runtime meta update (imports this file),
 *   4. `pwa-manifest.ts`: `theme_color` and `background_color` (the light value).
 */
export const THEME_COLORS = { light: "#faf5ee", dark: "#17120f" } as const;
