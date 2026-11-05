/**
 * The whole HTTP application as one route layer (docs/EFFECT.md E7, E8, E9; plan `docs/plans/e7-http-api.md` P11, P13,
 * P14, P16; E7-T11): what the Hono app of `src/index.ts` served before the cutover.
 *
 * `appRoutesLayer()` registers, on one `HttpRouter`:
 * - `globalHttpLayer()` (`./global.ts`): the request log, the security headers, CORS for `/api/*` and the origin guard,
 *   as global router middleware in Hono's `use` order (P11, deviation D6);
 * - `SystemApi` (`GET /api/health`, `GET /uploads/:filename`), `AuthApi` (`/api/auth`), `HouseholdsApi`
 *   (`/api/households`, the invite-token routes beside `/:householdId`; the router matches by specificity, so the old
 *   registration order no longer matters) with their handler layers;
 * - `moduleRoutesLayer(API_MODULES)` (`../modules/mount.ts`): every module's `householdApi` / `userApi` behind the
 *   module chain, plus the household catch-alls (P14);
 * - `fallbackRoutesLayer()` (`./global.ts`): the static web for a `GET` when `WEB_DIST_DIR` is set, else the JSON
 *   route-unknown `404`, at the lowest specificity (the Hono app's static web LAST and its `notFound`).
 * The core `HttpApiMiddleware` implementations (`httpMiddlewareLayer()`) are `Layer.provideMerge`d under the routes, so
 * `HttpApiBuilder.layer` finds them when it builds; the services the handlers and the middlewares yield come from the
 * one `AppLayer` (the in-memory composition of `./in-memory.ts`, or the runtime the server runs on, `./server.ts`).
 *
 * `app` is the in-memory handler over it (P13): `app.request(path, init)` keeps Hono's call shape, so every test that
 * imports `app` from `src/index.ts` runs through HttpApiBuilder's handlers unchanged (E9). It is built on the first
 * request, on a child memo map of `appMemoMap`, and never disposed in a test.
 *
 * `httpApiRoutes()` lists `METHOD path` of every endpoint the definitions declare (P16; `apps/api/test/api-doc.test.ts`
 * compares it with `docs/API.md`): the full path after every prefix, in Hono's `:name` syntax; the module catch-alls
 * and the fallback are not endpoints.
 *
 * Import cycle (P15): both functions are hoisted and read `API_MODULES`, the APIs and the handler layers only when
 * called; the one module-scope statement calls the hoisted `inMemoryHandler`, which builds nothing until a request.
 */
import { Layer } from "effect";
import type { HttpApi } from "effect/http-api";
import { HttpApiBuilder } from "effect/http-api";
import { AuthApi } from "../core/routes/auth.api.ts";
import { authHandlers } from "../core/routes/auth.ts";
import { HouseholdsApi } from "../core/routes/households.api.ts";
import { householdsHandlers } from "../core/routes/households.ts";
import { SystemApi } from "../core/routes/system.api.ts";
import { systemHandlers } from "../core/routes/system.ts";
import { API_MODULES } from "../modules/index.ts";
import { moduleRoutesLayer } from "../modules/mount.ts";
import { fallbackRoutesLayer, globalHttpLayer } from "./global.ts";
import { type InMemoryApp, inMemoryHandler } from "./in-memory.ts";
import { httpMiddlewareLayer } from "./middleware-layer.ts";

/** Any `HttpApi` the app serves. */
type AnyApi = HttpApi.HttpApi<string, any>;

/** One endpoint as the api-doc test reads it: the method and the full path. */
export interface ServedRoute {
  readonly method: string;
  readonly path: string;
}

/** The core APIs, in the order the Hono app mounted them (system, auth, households). */
function coreApis(): ReadonlyArray<AnyApi> {
  return [SystemApi, AuthApi, HouseholdsApi];
}

/** Every module API of the build: each module's `householdApi`, then its `userApi`. */
function moduleApis(): ReadonlyArray<AnyApi> {
  return API_MODULES.flatMap((module) => [...(module.householdApi?.apis ?? []), ...(module.userApi?.apis ?? [])]);
}

/** Every endpoint of `api` (method, full path after every prefix), in the API's group and endpoint order. */
function endpointsOf(api: AnyApi): ServedRoute[] {
  const routes: ServedRoute[] = [];
  for (const group of Object.values(api.groups) as ReadonlyArray<{ readonly endpoints: Record<string, ServedRoute> }>) {
    for (const endpoint of Object.values(group.endpoints)) routes.push({ method: endpoint.method, path: endpoint.path });
  }
  return routes;
}

/** `METHOD path` of every endpoint of the core and module APIs (P16). */
export function httpApiRoutes(): string[] {
  return [...coreApis(), ...moduleApis()].flatMap((api) =>
    endpointsOf(api).map((route) => `${route.method} ${route.path}`),
  );
}

/** The application's routes on one router (see the file comment). */
export function appRoutesLayer() {
  return Layer.mergeAll(
    globalHttpLayer(),
    HttpApiBuilder.layer(SystemApi).pipe(Layer.provide(systemHandlers)),
    HttpApiBuilder.layer(AuthApi).pipe(Layer.provide(authHandlers)),
    HttpApiBuilder.layer(HouseholdsApi).pipe(Layer.provide(householdsHandlers)),
    moduleRoutesLayer(API_MODULES),
    fallbackRoutesLayer(),
  ).pipe(Layer.provideMerge(httpMiddlewareLayer()));
}

/** The in-memory app the tests call (`app.request`, P13), built on its first request. */
export const app: InMemoryApp = inMemoryHandler(appRoutesLayer);
