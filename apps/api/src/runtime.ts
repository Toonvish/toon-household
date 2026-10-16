/**
 * The API's one Effect runtime (docs/EFFECT.md E7, E12).
 *
 * `AppLayer` is the application layer every Effect run of this process is built
 * from. It is `Layer.empty` today and is typed `Layer.Layer<never>` so that E2 can
 * widen it: E2 fills it with the core services (`AppConfig`, `Database`, `Mailer`,
 * `Uploads`, `RateLimiter`, `OAuthProviders`), E3 and E4 merge in each module's
 * `layer`. `runtime` is the ONE `ManagedRuntime` of the process (no other
 * application file calls `ManagedRuntime.make`): Hono handlers bridge into Effect
 * with `runtime.runPromise(...)` until E7 replaces Hono.
 *
 * The memo map is shared (`appMemoMap`, the pattern of
 * `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`): a layer is
 * memoized per memo map, so a script or test runtime made with the same map reuses
 * the services this one built instead of building a second database client.
 *
 * `src/index.ts` disposes the runtime on SIGTERM/SIGINT, after the modules'
 * `shutdown()`; disposing closes the layer scope (the resources E2's layers will
 * acquire) and every later run dies with "ManagedRuntime disposed". Nothing may run
 * an effect on it at module scope: `ManagedRuntime.make` builds the layer lazily
 * on the first run, and a run at import time would re-enter the API's import
 * cycle (CLAUDE.md "API import cycle"). Never dispose it in a test: the tests share
 * one process and one runtime.
 */
import { Layer, ManagedRuntime } from "effect";

export const AppLayer: Layer.Layer<never> = Layer.empty;

export const appMemoMap = Layer.makeMemoMapUnsafe();

export const runtime = ManagedRuntime.make(AppLayer, { memoMap: appMemoMap });
