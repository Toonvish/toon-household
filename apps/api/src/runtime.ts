/**
 * The API's one Effect runtime (docs/EFFECT.md E7, E12; plan `docs/plans/e2-api-core-services.md` P3).
 *
 * `AppLayer` is the application layer every Effect run of this process is built from:
 * the modules' own layers (`moduleLayers()`; recipe's since E3, finance's since E4; plans
 * `docs/plans/e3-recipe-services.md` P3, `docs/plans/e4-finance-services.md` P3) over the core services (`src/core/services/layer.ts`)
 * over the infrastructure (`src/infra.ts`: `Database` over `AppConfig`, the mailer, uploads,
 * thumbnails and the rate limiter). A module service may therefore use any core or
 * infrastructure service (`ModuleRequirements`, `src/modules/types.ts`), never the reverse. `runtime` is the ONE `ManagedRuntime` of the process (no other application
 * file calls `ManagedRuntime.make`): Hono handlers bridge into Effect with
 * `runtime.runPromise(...)` until E7 replaces Hono.
 *
 * `AppLayer` is `Layer.suspend` over the HOISTED `appLayer()`, and it is annotated with a
 * `never` requirement: a service left unsatisfied by a wrong nesting is a `tsc` error here,
 * not a surprise in `ManagedRuntime.make`. The module scope of this file reads no imported
 * binding except `Layer` and `ManagedRuntime`, so it can be imported from anywhere in the
 * API's import cycle (CLAUDE.md "API import cycle"): the composition functions run when the
 * layer is first built, on the first run.
 *
 * The memo map is shared (`appMemoMap`, the pattern of
 * `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`): a layer is memoized
 * per memo map, so a script or test runtime made with the same map reuses the services
 * this one built instead of building a second database client.
 *
 * `src/index.ts` disposes the runtime on SIGTERM/SIGINT, after the modules'
 * `shutdown()`; disposing closes the layer scope (`Database.layer`'s release closes the
 * client and logs `[db] database closed`; never under `NODE_ENV=test`) and every later run
 * dies with "ManagedRuntime disposed". Nothing may run an effect on it at module scope:
 * `ManagedRuntime.make` builds the layer lazily on the first run, and a run at import time
 * would re-enter the API's import cycle. Never dispose it in a test: the tests share one
 * process and one runtime.
 */
import { Layer, ManagedRuntime } from "effect";
import { type CoreServices, coreServicesLayer } from "./core/services/layer.ts";
import { type InfraServices, infraLayer } from "./infra.ts";
import type { DatabaseError } from "./lib/errors.ts";
import { API_MODULES, type ModuleServices } from "./modules/index.ts";
import type { ModuleLayer } from "./modules/types.ts";

/** Every service the runtime provides. */
export type AppServices = InfraServices | CoreServices | ModuleServices;

/** What building the `AppLayer` can fail with (the database's acquire at boot). */
export type AppLayerError = DatabaseError;

/**
 * The whole composition (plan e2 P3, e3 P3): the modules' own layers over the core services over the infrastructure.
 * `Layer.mergeAll` wants at least one layer, hence the leading `Layer.empty`. Read at build, never at import.
 */
function appLayer(): Layer.Layer<AppServices, AppLayerError, never> {
  return Layer.mergeAll(Layer.empty, ...moduleLayers()).pipe(
    Layer.provideMerge(coreServicesLayer()),
    Layer.provideMerge(infraLayer()),
  );
}

/**
 * Each build module's own `layer` (recipe's since E3; finance's since E4, `Layer.suspend(financeLayer)`). `API_MODULES` is read here, inside the
 * function, never at import (CLAUDE.md "API import cycle").
 *
 * The ONE cast of the composition: the registry lists every manifest as a plain `ApiModule`, whose `layer` outputs
 * `never` (a layer's output is contravariant, so `ApiModule<RecipeServices>` is one). This function is the place that
 * knows the build modules together provide `ModuleServices`; each manifest's own annotation
 * (`recipeModule: ApiModule<RecipeServices>`) is what `tsc` checks against its composition.
 */
function moduleLayers(): ModuleLayer<ModuleServices>[] {
  return API_MODULES.flatMap((module) =>
    module.layer === undefined ? [] : [module.layer as ModuleLayer<ModuleServices>],
  );
}

export const AppLayer: Layer.Layer<AppServices, AppLayerError, never> = Layer.suspend(appLayer);

export const appMemoMap = Layer.makeMemoMapUnsafe();

export const runtime = ManagedRuntime.make(AppLayer, { memoMap: appMemoMap });
