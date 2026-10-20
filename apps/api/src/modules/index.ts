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
 * imports (services → core/services/households/modules.ts, db/migrate.ts, and since E2-T12 the
 * middlewares → runtime.ts) come back here while this file is still evaluating.
 *
 * `API_MODULES` is therefore a LAZY list (E2-T12, plan e2 P21): a manifest imported FIRST in a fresh
 * process (`apps/api/test/import-order-effect.test.ts`) reaches this file while its own binding is
 * still in the temporal dead zone, so the array of wrapped manifests is built on the first access
 * (`.map`, `for…of`, `.length`, …), which is always inside a function after every manifest has
 * evaluated. A read at module scope during that window still fails loudly, as a `const` array did.
 */
import { fromPromiseModule } from "./adapter.ts";
import { financeModule } from "./finance/index.ts";
import { recipeModule } from "./recipe/index.ts";
import type { ApiModule } from "./types.ts";

/** The wrapped manifests, built once on first use. */
let built: readonly ApiModule[] | undefined;

function builtModules(): readonly ApiModule[] {
  built ??= [fromPromiseModule(recipeModule), fromPromiseModule(financeModule)];
  return built;
}

/** Forwards every read of the (empty, array-shaped) target to the built list. */
const lazyModules: ProxyHandler<ApiModule[]> = {
  get: (_target, key) => Reflect.get(builtModules(), key),
  has: (_target, key) => Reflect.has(builtModules(), key),
  ownKeys: () => Reflect.ownKeys(builtModules()),
  getOwnPropertyDescriptor: (_target, key) =>
    key === "length" ? Reflect.getOwnPropertyDescriptor([], key) : Reflect.getOwnPropertyDescriptor(builtModules(), key),
};

export const API_MODULES: readonly ApiModule[] = new Proxy<ApiModule[]>([], lazyModules);
