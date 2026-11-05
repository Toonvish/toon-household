/**
 * The transitional bridge: an Effect `HttpApi` served THROUGH the Hono app (docs/EFFECT.md E8, E9; plan
 * `docs/plans/e7-http-api.md` P1, P13). E7-T11 deletes this file, together with the Hono app.
 *
 * `effectBridge(api, handlers, mountedAt)` is a `Hono<AppEnv>` sub-app that registers EXACTLY the API's endpoints, in
 * the API's group and endpoint order: each endpoint's method, on its full path minus `mountedAt` (`"/"` when the path
 * IS `mountedAt`, which Hono's `app.route(mountedAt, bridge)` joins back to the bare prefix). Every request is forwarded
 * as it came (`c.req.raw`, the full URL) to the in-memory web handler of the API, and its response is returned as is
 * (status, body, `Location`, `Set-Cookie`); the Hono middlewares around the mount still decorate it. Because only the
 * API's own routes are registered, `app.routes` keeps listing every `METHOD path` and an unknown path still falls
 * through to the Hono app's own 404.
 *
 * The web handler (`effectBridgeHandler`) is `inMemoryHandler` over `HttpApiBuilder.layer(api)` with `handlers` and the
 * core middlewares (`httpMiddlewareLayer()`), built lazily on the first request: `AppLayer` sits in `appMemoMap` first,
 * then the router is built on a CHILD memo map, so the handlers see the one `AppLayer` (the shared test database, the
 * `setMailer` seam, the limiter state) while every bridge gets its OWN `HttpRouter` (never `toWebHandler` on the shared
 * `appMemoMap`, where every handler of the process would share one router).
 *
 * Transitional artefacts (P1): a module route bridged inside a Hono module router passes the module chain twice
 * (Hono's mount, then the API's own; the second pass sees the renewed session and writes nothing), and a bridged
 * request has no socket address (`clientIp` falls back to `"unknown"`, as every in-process test already does).
 *
 * Import cycle (P15): `effectBridge` is a hoisted function the route files call at module scope; it reads only `Hono`,
 * the API value and the hoisted `inMemoryHandler` there, and the middleware layers when the first request arrives.
 */
import { Layer } from "effect";
import type { HttpApi } from "effect/http-api";
import { HttpApiBuilder } from "effect/http-api";
import { Hono } from "hono";
import type { AppEnv } from "../lib/types.ts";
import { type InMemoryApp, inMemoryHandler } from "./in-memory.ts";
import { httpMiddlewareLayer } from "./middleware-layer.ts";

/** Any `HttpApi` a bridge serves. */
type AnyApi = HttpApi.HttpApi<string, any>;

/** One endpoint of an API as the bridge registers it: the method and the full path. */
export interface BridgedRoute {
  readonly method: string;
  readonly path: string;
}

/** Every endpoint of `api` (method, full path after every prefix), in the API's group and endpoint order. */
export function apiRoutes(api: AnyApi): BridgedRoute[] {
  const routes: BridgedRoute[] = [];
  for (const group of Object.values(api.groups) as ReadonlyArray<{ readonly endpoints: Record<string, BridgedRoute> }>) {
    for (const endpoint of Object.values(group.endpoints)) routes.push({ method: endpoint.method, path: endpoint.path });
  }
  return routes;
}

/** `path` relative to `mountedAt` (`"/"` for the mount itself); a path outside the mount is a wiring bug and throws. */
function relativeTo(mountedAt: string, path: string): string {
  if (path === mountedAt) return "/";
  if (mountedAt === "" || mountedAt === "/") return path;
  if (path.startsWith(`${mountedAt}/`)) return path.slice(mountedAt.length);
  throw new Error(`effectBridge: the endpoint path ${path} is not below the mount ${mountedAt}`);
}

/** The in-memory web handler of `api` with `handlers` and the core middlewares (P1, P13), built on its first request. */
export function effectBridgeHandler(api: AnyApi, handlers: Layer.Any): InMemoryApp {
  return inMemoryHandler(
    () =>
      HttpApiBuilder.layer(api).pipe(
        Layer.provide(handlers as Layer.Layer<any, any, any>),
        Layer.provideMerge(httpMiddlewareLayer()),
      ) as Layer.Layer<any, any, any>,
  );
}

/** A Hono sub-app for `app.route(mountedAt, …)` serving exactly the endpoints of `api` through its Effect handler (P1). */
export function effectBridge(api: AnyApi, handlers: Layer.Any, mountedAt: string): Hono<AppEnv> {
  const handler = effectBridgeHandler(api, handlers);
  const bridge = new Hono<AppEnv>();
  for (const route of apiRoutes(api)) {
    bridge.on(route.method, relativeTo(mountedAt, route.path), (c) => handler.fetch(c.req.raw));
  }
  return bridge;
}
