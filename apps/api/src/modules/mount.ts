/**
 * Mounts the build's modules (SPEC §2, D8):
 *
 *   userApi       -> /api/<id>/…                          (user-scoped, no household)
 *   householdApi  -> /api/households/:householdId/<id>/…  behind
 *                    ApiErrorBoundary -> RequireSession -> RequireHouseholdMember -> RequireModule
 *
 * The chain order is load-bearing and pinned by test/middleware.test.ts: no cookie answers 401 before anything else,
 * a non-member answers 403 before the module row is even looked at. A module API adds `RequireVerifiedEmail` itself
 * (its group or endpoint chain), where its writes are gated.
 *
 * `moduleRoutesLayer(modules)` (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P14, deviation D7) registers
 * the modules' `HttpApi`s on the router:
 * - At layer build it ASSERTS, per module, that every household endpoint runs boundary, session, member, module as its
 *   four OUTERMOST middlewares (`householdModuleApi` attaches them; the attached-last runs first, P6) and lies BELOW
 *   `/api/households/:householdId/<id>/` (never the bare prefix: the catch-all below registers it), and that every user
 *   endpoint lies below `/api/<id>/`. A violation is an `Effect.die` naming the module and the endpoint, so a wiring
 *   bug fails the first build (a test, the boot), never a request in production.
 * - It registers each API with `HttpApiBuilder.layer(api)` over the module's `handlers` (one layer for every group of
 *   the module; `HttpApiBuilder.layer` dies when a group has no handler).
 * - It registers ONE raw catch-all per household module on `/api/households/:householdId/<id>/*`, the way Hono's
 *   `use(\`${base}/*\`)` ran the chain for every path below the prefix: the same boundary → session → member → module
 *   checks, then the route-unknown `404` (`server.error.routeUnknown`). So an unknown path below a module still
 *   answers 401 without a cookie, 403 for a non-member, 404 `module_disabled` with the module off. Two rules from the
 *   router (`repos/effect/packages/effect/src/http/HttpRouter.ts` lines 162 to 174, verified for this file):
 *   - only `…/<id>/*` is registered: the router adds the bare `…/<id>` for a path ending in `/*` by itself, and a
 *     second registration of one method and path throws `Method '…' already declared` (FindMyWay);
 *   - `HttpRouter.add` once per EXPLICIT method `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, never `HEAD` and
 *     never `"*"`: a `"*"` route enters the `HEAD` tree too, so `HEAD …/recipe/shopping-lists` would hit the catch-all
 *     instead of falling back to the `GET` tree and the real route, as Hono served `HEAD` through the `GET` handler.
 *   A route the module defines wins over the catch-all by specificity (static and parametric before wildcard).
 *
 * What `moduleRoutesLayer` needs besides the router (the core middleware implementations of `httpMiddlewareLayer()`,
 * the module's own middleware layers inside its `handlers`, the platform services of `HttpApiBuilder.layer` and every
 * service the handlers yield) comes from the composition of plan P13 (`inMemoryHandler`), assembled with
 * `Layer.provideMerge`; the one cast below says so.
 *
 * Import cycle (P15): `moduleRoutesLayer` is a hoisted function; the module APIs, their handlers and the middleware
 * tags are read when the layer is BUILT, never at import.
 */
import type { ModuleId as SharedModuleId } from "@toon/shared";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ApiErrorBoundary, ModuleId, RequireHouseholdMember, RequireModule, RequireSession } from "../http/middleware.ts";
import { pathOf } from "../http/request.ts";
import { errorResponse } from "../http/response.ts";
import { routeUnknown } from "../lib/errors.ts";
import type { AnyHttpApi, ApiModule, ModuleHttpApi } from "./types.ts";

/** The methods a module catch-all is registered for: explicit, never `HEAD`, never `"*"` (see the file comment). */
const CATCH_ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/** Where a module's household routes live (`householdModuleApi` adds it). */
function householdPrefix(id: SharedModuleId): `/${string}` {
  return `/api/households/:householdId/${id}`;
}

/** Where a module's user routes live (`userModuleApi` adds it). */
function userPrefix(id: SharedModuleId): `/${string}` {
  return `/api/${id}`;
}

/** What the assertion reads of an endpoint. */
interface EndpointShape {
  readonly identifier: string;
  readonly method: string;
  readonly path: string;
  readonly middlewares: ReadonlySet<unknown>;
}

/** Every endpoint of `api` with its group's identifier, in the API's group and endpoint order. */
function endpointsOf(api: AnyHttpApi): Array<{ readonly group: string; readonly endpoint: EndpointShape }> {
  const result: Array<{ readonly group: string; readonly endpoint: EndpointShape }> = [];
  for (const group of Object.values(api.groups) as ReadonlyArray<HttpApiGroup.Top>) {
    for (const endpoint of Object.values(group.endpoints) as ReadonlyArray<EndpointShape>) {
      result.push({ group: group.identifier, endpoint });
    }
  }
  return result;
}

/** The refusal of the build: an `Error` naming the module, the endpoint and the rule it breaks. */
function wiringDefect(id: SharedModuleId, group: string, endpoint: EndpointShape, rule: string): Error {
  return new Error(
    `moduleRoutesLayer: module "${id}", endpoint ${group}.${endpoint.identifier} (${endpoint.method} ${endpoint.path}): ${rule}`,
  );
}

/**
 * Every household endpoint of `apis`: the four outermost middlewares are boundary, session, member, module (in
 * EXECUTION order; `endpoint.middlewares` holds them in attach order, the last attached outermost), and the path lies
 * below the module prefix. Dies with `wiringDefect` on the first endpoint that does not.
 */
const assertHouseholdApis = Effect.fn("moduleRoutesLayer.assertHouseholdApis")(function* (
  id: SharedModuleId,
  apis: ReadonlyArray<AnyHttpApi>,
) {
  // Attach order (innermost first) of the four tags `householdModuleApi` puts outermost.
  const moduleChain: ReadonlyArray<unknown> = [RequireModule, RequireHouseholdMember, RequireSession, ApiErrorBoundary];
  const prefix = householdPrefix(id);
  for (const api of apis) {
    for (const { group, endpoint } of endpointsOf(api)) {
      const outermost = [...endpoint.middlewares].slice(-moduleChain.length);
      if (outermost.length !== moduleChain.length || outermost.some((tag, i) => tag !== moduleChain[i])) {
        return yield* Effect.die(
          wiringDefect(
            id,
            group,
            endpoint,
            "the four outermost middlewares must run ApiErrorBoundary -> RequireSession -> RequireHouseholdMember -> RequireModule (build the API with householdModuleApi)",
          ),
        );
      }
      if (!endpoint.path.startsWith(`${prefix}/`)) {
        return yield* Effect.die(wiringDefect(id, group, endpoint, `the path must lie below ${prefix}/`));
      }
    }
  }
});

/** Every user endpoint of `apis` lies below `/api/<id>/`; dies with `wiringDefect` otherwise. */
const assertUserApis = Effect.fn("moduleRoutesLayer.assertUserApis")(function* (
  id: SharedModuleId,
  apis: ReadonlyArray<AnyHttpApi>,
) {
  const prefix = userPrefix(id);
  for (const api of apis) {
    for (const { group, endpoint } of endpointsOf(api)) {
      if (!endpoint.path.startsWith(`${prefix}/`)) {
        return yield* Effect.die(wiringDefect(id, group, endpoint, `the path must lie below ${prefix}/`));
      }
    }
  }
});

/** `HttpApiBuilder.layer` of every API over the module's one handler layer. */
function apisLayer(contribution: ModuleHttpApi, apis: ReadonlyArray<AnyHttpApi>) {
  return Layer.mergeAll(Layer.empty, ...apis.map((api) => HttpApiBuilder.layer(api))).pipe(
    Layer.provide(contribution.handlers),
  );
}

/** A middleware implementation as `HttpApiBuilder` applies it: the effect behind it and the endpoint it runs for. */
type AppliedMiddleware = (
  httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, unknown>,
  options: { readonly group: unknown; readonly endpoint: unknown },
) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, unknown>;

/** The answer at the end of a catch-all's chain: the JSON route-unknown `404` of every unknown route. */
const routeUnknownResponse = Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
  errorResponse(routeUnknown(request.method, pathOf(request.originalUrl))),
);

/**
 * The catch-all of household module `id` (see the file comment): the module chain around the route-unknown `404`, on
 * `…/<id>/*` once per explicit method. The chain is applied as `HttpApiBuilder` applies an endpoint's (innermost
 * first, each implementation called with the group and the endpoint it runs for), on a group annotated with the
 * module's `ModuleId`, which is what `RequireModule` reads. The implementations are read as `AppliedMiddleware`
 * (`HttpApiBuilder`'s own `applyMiddleware` reads them untyped the same way): each tag's service type names the
 * services it provides to the effect behind it, which a hand-built chain cannot thread through the compiler; the
 * chain is the one `householdModuleApi` attaches, so what each provides is what the next requires.
 */
function moduleCatchAllLayer(id: SharedModuleId) {
  return HttpRouter.use(
    Effect.fnUntraced(function* (router) {
      const innermostFirst = [
        yield* RequireModule,
        yield* RequireHouseholdMember,
        yield* RequireSession,
        yield* ApiErrorBoundary,
      ] as ReadonlyArray<AppliedMiddleware>;
      const endpoint = HttpApiEndpoint.get("unknownRoute", "/*");
      const options = { group: HttpApiGroup.make(`${id}.unknownRoute`).add(endpoint).annotate(ModuleId, id), endpoint };
      const handler = innermostFirst.reduce(
        (inner: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, unknown>, middleware) =>
          middleware(inner, options),
        routeUnknownResponse,
      );
      for (const method of CATCH_ALL_METHODS) {
        yield* router.add(method, `${householdPrefix(id)}/*`, handler);
      }
    }),
  );
}

/** The routes of one module: its APIs (asserted first) and, for a household API, the catch-all. */
function moduleLayer(module: ApiModule) {
  const layers = [];
  const household = module.householdApi;
  if (household !== undefined) {
    layers.push(
      Layer.unwrap(
        Effect.gen(function* () {
          const apis = household.apis;
          yield* assertHouseholdApis(module.id, apis);
          return Layer.merge(apisLayer(household, apis), moduleCatchAllLayer(module.id));
        }),
      ),
    );
  }
  const user = module.userApi;
  if (user !== undefined) {
    layers.push(
      Layer.unwrap(
        Effect.gen(function* () {
          const apis = user.apis;
          yield* assertUserApis(module.id, apis);
          return apisLayer(user, apis);
        }),
      ),
    );
  }
  return Layer.mergeAll(Layer.empty, ...layers);
}

/**
 * Every module's routes (P14): the build-time assertion, `HttpApiBuilder.layer` per API with the module's handlers,
 * the household catch-alls. A hoisted function, evaluated lazily by the caller (P15).
 *
 * The ONE cast of the module side (P14): `ModuleHttpApi.handlers` is `Layer.Layer<any, never, any>` (see its doc
 * comment in `./types.ts`), so the composed requirements are `any`; what this layer needs from the router machinery
 * is the `HttpRouter`, and everything else it requires (the core middleware implementations, `HttpApiBuilder.layer`'s
 * platform services `Etag.Generator`, `FileSystem`, `HttpPlatform`, `Path`, the services the handlers yield) is in the
 * output of the P13 composition (`inMemoryHandler`: `httpMiddlewareLayer()`, `AppLayer`,
 * `BunHttpServer.layerHttpServices`, all `Layer.provideMerge`d under it), which is where it is checked: the build of
 * `apps/api/test/modules.test.ts` (m).
 */
export function moduleRoutesLayer(modules: readonly ApiModule[]): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  return Layer.mergeAll(Layer.empty, ...modules.map(moduleLayer)) as Layer.Layer<never, never, HttpRouter.HttpRouter>;
}
