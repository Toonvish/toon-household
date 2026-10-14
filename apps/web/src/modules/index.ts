/**
 * THE web module registry (SPEC §2): every manifest the build ships, in nav order.
 * The core reaches a module only through this list (routes, nav, persist policy,
 * mutation defaults) and through `modules/catalogs.ts` (catalog types).
 *
 * Never import this file from a catalog or from `lib/i18n`: manifests import routes and
 * screens, which import `@/lib/i18n` — a cycle (plan m0 §1 decision 6). And never derive a
 * module-level constant from `WEB_MODULES` in a file a manifest imports; compute at call
 * time (see `components/layout/nav-items.ts`).
 *
 * Nothing a manifest imports STATICALLY may import this file (plan m2-recipe-module §1
 * decision 15): it evaluates `[recipeModule]`, so a path back here from the manifest's
 * graph reads the manifest in its temporal dead zone. Module screens are lazy and the
 * route roots live in `route-roots.tsx` (no shell, no registry) for that reason.
 *
 * LITERAL-TYPED: `as const satisfies`, never an annotation. Each manifest is itself
 * literal-typed, so `router.tsx`'s `WEB_MODULES.map((m) => m.route)` keeps the concrete
 * route types and the registered tree stays strict (decision 10). A consumer that wants
 * the wide type takes `readonly WebModule[]` — the tuple is assignable to it.
 *
 * Today: `recipeModule`. M3 appends `financeModule`.
 */
import { recipeModule } from "./recipe";
import type { WebModule } from "./types";

export const WEB_MODULES = [recipeModule] as const satisfies readonly WebModule[];

export type { WebModule } from "./types";
