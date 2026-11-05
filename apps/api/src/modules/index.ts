/**
 * The modules this BUILD contains (SPEC §2) — the core's only door into a module.
 * `/api/health` reports their ids, the module mount (modules/mount.ts) mounts their
 * routers, and `runMigrations`, `seed`, `uploads:gc` and the shutdown handler call
 * their hooks. Recipe joined in M2, finance joins in M3.
 *
 * The core sees only the Effect contract `ApiModule` (docs/EFFECT.md E7; plan e2 P11). Recipe
 * implements it directly since E3 (plan e3 P3) and is listed unwrapped; finance is the one
 * Promise manifest left (`PromiseApiModule`, until E4-T07), wrapped once here by `fromPromiseModule`
 * (./adapter.ts). `ModuleServices` names every service the modules' own layers provide; the
 * runtime (`src/runtime.ts`) adds it to `AppServices` (E4 adds `FinanceServices`).
 *
 * Until E4-T07 the finance entry is the wrapped Promise manifest PLUS the module's own layer
 * (`Layer.suspend(financeLayer)`, plan `docs/plans/e4-finance-services.md` P3): the routes and the
 * middleware yield the finance services from the `AppLayer` while the hooks still come from the
 * Promise manifest. E4-T07 lists `financeModule` unwrapped (`ApiModule<FinanceServices>`).
 *
 * Read `API_MODULES` inside functions only, never at module load: a manifest's own
 * imports (services → core/services/households/modules.ts, db/migrate.ts, and since E2-T12 the
 * middlewares → runtime.ts) come back here while this file is still evaluating.
 *
 * `API_MODULES` is therefore a LAZY list (E2-T12, plan e2 P21): a manifest imported FIRST in a fresh
 * process (`apps/api/test/import-order-effect.test.ts`) reaches this file while its own binding is
 * still in the temporal dead zone, so the array of manifests is built on the first access
 * (`.map`, `for…of`, `.length`, …), which is always inside a function after every manifest has
 * evaluated. A read at module scope during that window still fails loudly, as a `const` array did.
 */
import { Layer } from "effect";
import { fromPromiseModule } from "./adapter.ts";
import { financeModule } from "./finance/index.ts";
import { type FinanceServices, financeLayer } from "./finance/layer.ts";
import { recipeModule } from "./recipe/index.ts";
import type { RecipeServices } from "./recipe/layer.ts";
import type { ApiModule } from "./types.ts";

/** Every service the build modules' own layers provide. */
export type ModuleServices = RecipeServices | FinanceServices;

/** The manifests (finance wrapped, with its layer until E4-T07), built once on first use. */
let built: readonly ApiModule[] | undefined;

function builtModules(): readonly ApiModule[] {
  built ??= [recipeModule, { ...fromPromiseModule(financeModule), layer: Layer.suspend(financeLayer) }];
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
