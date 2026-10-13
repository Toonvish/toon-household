/**
 * THE web module registry (SPEC §2): every manifest the build ships, in nav order.
 * The core reaches a module only through this list (routes, nav, persist policy,
 * mutation defaults) and through `modules/catalogs.ts` (catalog types).
 *
 * Never import this file from a catalog or from `lib/i18n`: manifests import routes and
 * screens, which import `@/lib/i18n` — a cycle (plan §1 decision 6). And never derive a
 * module-level constant from `WEB_MODULES` in a file a manifest imports; compute at call
 * time (see `components/layout/nav-items.ts`).
 *
 * M0: empty. M2 adds `recipeModule`, M3 `financeModule`.
 */
import type { WebModule } from "./types";

export const WEB_MODULES: readonly WebModule[] = [];

export type { WebModule } from "./types";
