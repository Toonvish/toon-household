/**
 * Mini HTTP apps for isolated tests of the Effect HTTP layer (docs/EFFECT.md E9; plan `docs/plans/e7-http-api.md` P13).
 *
 * `testHttpApp(apis, handlers, extra?)` serves the `HttpApi`s `apis` with the group handler layer(s) `handlers` through
 * `inMemoryHandler` (`apps/api/src/http/in-memory.ts`): its own child memo map of `appMemoMap` (the one `AppLayer`: the
 * shared test database, the mail seam, the limiter store) and its OWN `HttpRouter`, so two apps in one process never
 * share a route or a global middleware. `ApiErrorBoundaryLayer` is always provided; `extra` adds what a test needs
 * besides (the core middleware layers, a global HTTP layer, a test middleware), provided to the handlers and the APIs
 * alike. The result has Hono's `app.request(path, init)` call shape.
 */
import { Layer } from "effect";
import type { HttpApi } from "effect/http-api";
import { HttpApiBuilder } from "effect/http-api";
import { type InMemoryApp, inMemoryHandler } from "../../src/http/in-memory.ts";
import { ApiErrorBoundaryLayer } from "../../src/http/response.ts";

export type { InMemoryApp };

/** An in-memory app serving `apis` with `handlers` (and `extra`), built on its first request. */
export function testHttpApp(
  apis: ReadonlyArray<HttpApi.HttpApi<string, any>>,
  handlers: Layer.Any,
  extra?: Layer.Any,
): InMemoryApp {
  return inMemoryHandler(
    () =>
      Layer.mergeAll(
        Layer.empty,
        ...apis.map((api) => HttpApiBuilder.layer(api) as Layer.Layer<never, never, any>),
      ).pipe(
        Layer.provide(handlers as Layer.Layer<any, any, any>),
        Layer.provideMerge((extra ?? Layer.empty) as Layer.Layer<any, any, any>),
        Layer.provideMerge(ApiErrorBoundaryLayer),
      ) as Layer.Layer<any, any, any>,
  );
}
