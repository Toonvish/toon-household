/**
 * An `HttpRouter` app served in memory, the test seam (`app` of `./app.ts`, `testHttpApp`; docs/EFFECT.md E9; plan
 * `docs/plans/e7-http-api.md` P1, P13).
 *
 * `inMemoryHandler(makeLayer)` returns `{ request, fetch }` over `HttpRouter.toWebHandler`, built on the FIRST call
 * (never at import: this file sits in the API's import cycle, CLAUDE.md "API import cycle") and never disposed in
 * tests:
 * 1. the first call awaits `runtime.runPromise(Effect.void)`, so `AppLayer` sits in `appMemoMap` before anything else
 *    is built;
 * 2. the handler is built on a FRESH child memo map, `Layer.forkMemoMapUnsafe(appMemoMap)`: `AppLayer` is found in the
 *    parent (one database, one limiter, one mailer seam), while `HttpRouter.layer` (a module constant, memoised by
 *    identity), the route layers and the global middlewares are built anew for each handler. On the shared map every
 *    in-memory handler of the process would share ONE router (a second `/*` registration throws, a route layer is
 *    silently not registered again, test routes leak into later handlers);
 * 3. the layer is `makeLayer()` assembled with `Layer.provideMerge` over `AppLayer` and
 *    `BunHttpServer.layerHttpServices`, never `Layer.provide`: a service a handler yields must be in the OUTPUT for
 *    `toWebHandler` to drop it from the per-request requirements. The caller's layer brings the middleware layers it
 *    needs (`appRoutesLayer()` and `testHttpApp` do);
 * 4. `request(input, init?)` resolves a relative path against `http://localhost`, as Hono's `app.request` did.
 */
import { Effect, Layer, type Scope } from "effect";
import type { HttpRouter } from "effect/http";
import { HttpRouter as Router } from "effect/http";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { type AppServices, AppLayer, appMemoMap, runtime } from "../runtime.ts";

/** What `inMemoryHandler` serves: `app.request` (Hono's call shape) and a plain `fetch`. */
export interface InMemoryApp {
  readonly request: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly fetch: (request: Request) => Promise<Response>;
}

/** The services the assembly provides to the caller's layer. */
type Assembled = AppServices | Layer.Success<typeof BunHttpServer.layerHttpServices>;

/**
 * What the caller's layer may still require: the router, the assembled services, and the router's request markers
 * for services its own output, the assembly or the router provide (anything else is a `tsc` error at the call).
 */
type Allowed<A> =
  | HttpRouter.HttpRouter
  | Assembled
  | HttpRouter.Request<"Requires", A | Assembled | Scope.Scope | HttpRouter.Provided>
  | HttpRouter.Request<"GlobalRequires", A | Assembled | Scope.Scope | HttpRouter.Provided>
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>;

/** `Hono#request`'s URL rule: an absolute `http(s)` URL as is, anything else below `http://localhost`. */
function toRequest(input: string | URL | Request, init?: RequestInit): Request {
  if (input instanceof Request) return init ? new Request(input, init) : input;
  const url = input.toString();
  return new Request(/^https?:\/\//.test(url) ? url : `http://localhost${url.startsWith("/") ? url : `/${url}`}`, init);
}

/** Builds the web handler (see the file comment, steps 1 to 3). */
async function buildHandler(makeLayer: () => Layer.Layer<unknown, unknown, unknown>) {
  await runtime.runPromise(Effect.void);
  const layer = makeLayer().pipe(
    Layer.provideMerge(AppLayer),
    Layer.provideMerge(BunHttpServer.layerHttpServices),
  ) as Layer.Layer<unknown, unknown, HttpRouter.HttpRouter>;
  const { handler } = Router.toWebHandler(layer, {
    memoMap: Layer.forkMemoMapUnsafe(appMemoMap),
    disableLogger: true,
  });
  return (request: Request): Promise<Response> => handler(request);
}

/** An app over the route layer `makeLayer()` returns, built lazily on the first request (P13). */
export function inMemoryHandler<A, E, R extends Allowed<A>>(makeLayer: () => Layer.Layer<A, E, R>): InMemoryApp {
  let built: Promise<(request: Request) => Promise<Response>> | undefined;
  const fetch = async (request: Request): Promise<Response> => {
    built ??= buildHandler(makeLayer as () => Layer.Layer<unknown, unknown, unknown>);
    return (await built)(request);
  };
  return { fetch, request: (input, init) => fetch(toRequest(input, init)) };
}
