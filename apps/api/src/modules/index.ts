/**
 * The modules this BUILD contains (SPEC §2) — the core's only door into a module.
 * `/api/health` reports their ids, the module mount (modules/mount.ts) mounts their
 * routers, and `runMigrations`, `seed`, `uploads:gc` and the shutdown handler call
 * their hooks. Recipe joined in M2, finance joins in M3.
 *
 * The manifests are still Promise-based (`PromiseApiModule`) until E3 and E4; each is
 * wrapped once here by `fromPromiseModule` (./adapter.ts), so the core sees only the
 * Effect contract `ApiModule` (docs/EFFECT.md E7; plan e2 P11).
 *
 * Read `API_MODULES` inside functions only, never at module load: a manifest's own
 * imports (services → core/services/households/modules.ts, db/migrate.ts) come back
 * here while this file is still evaluating.
 */
import { fromPromiseModule } from "./adapter.ts";
import { financeModule } from "./finance/index.ts";
import { recipeModule } from "./recipe/index.ts";
import type { ApiModule } from "./types.ts";

export const API_MODULES: readonly ApiModule[] = [fromPromiseModule(recipeModule), fromPromiseModule(financeModule)];
