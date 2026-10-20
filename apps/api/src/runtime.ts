/**
 * The API's one Effect runtime (docs/EFFECT.md E7, E12; plan `docs/plans/e2-api-core-services.md` P3).
 *
 * `AppLayer` is the application layer every Effect run of this process is built from:
 * the core services (`src/core/services/layer.ts`; E3 and E4 merge in each module's
 * `layer` through `moduleLayers()`, E2-T05) over the infrastructure (`src/infra.ts`:
 * `Database` over `AppConfig`, E2-T04 adds the mailer, uploads, thumbnails and the rate
 * limiter). `runtime` is the ONE `ManagedRuntime` of the process (no other application
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
import type { AppConfig } from "./config.ts";
import { coreServicesLayer } from "./core/services/layer.ts";
import type { UploadReferences } from "./core/services/media/references.ts";
import type { Database } from "./db/database.ts";
import { infraLayer } from "./infra.ts";
import type { DatabaseError } from "./lib/errors.ts";
import { API_MODULES } from "./modules/index.ts";
import type { ModuleLayer } from "./modules/types.ts";

/** Every service the runtime provides. */
export type AppServices = AppConfig | Database | UploadReferences;

/** What building the `AppLayer` can fail with (the database's acquire at boot). */
export type AppLayerError = DatabaseError;

/**
 * The whole composition (plan e2 P3): the core services and the modules' own layers over the infrastructure. Read at
 * build, never at import.
 */
function appLayer(): Layer.Layer<AppServices, AppLayerError, never> {
  return Layer.mergeAll(coreServicesLayer(), ...moduleLayers()).pipe(Layer.provideMerge(infraLayer()));
}

/**
 * Each build module's own `layer` (E3, E4; absent for both modules in E2, so this is `[]` today). `API_MODULES` is read
 * here, inside the function, never at import (CLAUDE.md "API import cycle").
 */
function moduleLayers(): ModuleLayer[] {
  return API_MODULES.flatMap((module) => (module.layer === undefined ? [] : [module.layer]));
}

export const AppLayer: Layer.Layer<AppServices, AppLayerError, never> = Layer.suspend(appLayer);

export const appMemoMap = Layer.makeMemoMapUnsafe();

export const runtime = ManagedRuntime.make(AppLayer, { memoMap: appMemoMap });
