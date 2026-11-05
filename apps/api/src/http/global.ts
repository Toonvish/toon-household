/**
 * The global HTTP layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P11, deviation D6): what Hono ran around
 * every router, as router middleware, plus the fallback route.
 *
 * `globalHttpLayer()` is ONE `Layer.effectDiscard(Effect.gen(...))`: it prepares what the middlewares need (the CSP
 * with the hashes of the built `index.html`, read once here, and the CORS origins) and THEN registers the four with
 * `router.addGlobalMiddleware`, one after the other in this one generator. The first registered is the OUTERMOST
 * (`HttpRouter.asHttpEffect` reverses the set before wrapping), so the order is Hono's `use` order:
 *   1. the request log (off under `NODE_ENV=test`, like Hono's `logger()`),
 *   2. the security headers (a pre-response handler: every response, preflight and error bodies included),
 *   3. CORS for `/api/*` (the preflight `204` and the headers of every other `/api/*` response),
 *   4. the origin guard for `/api/*` (`403` before routing).
 * It is never a `Layer.mergeAll` of four global `HttpRouter.middleware` layers: `mergeAll` builds its members
 * concurrently, so a security-headers layer that finished its file read after CORS would leave the preflight `204` and
 * the origin guard's `403` without security headers (`apps/api/test/http-contract.test.ts` rows 2 and 4). These are
 * ROUTER middlewares, not `HttpApiMiddleware`s: they must also cover the preflight, the static web, `/uploads`, the
 * fallback `404` and requests no endpoint matches (D6). A global middleware never sees a typed failure: each answers
 * with a response. There is no locale middleware (P4).
 *
 * `fallbackRoutesLayer()` is the route layer that answers everything no other route matches: the path `*` (registered
 * once, lowest specificity; never `/*`, which `HttpRouter` would also register as the bare `""`), added once per
 * EXPLICIT method `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS`, never `HEAD` and never the method `*`: a
 * `*`-method route enters the `HEAD` tree and would shadow the router's `HEAD` to `GET` fallback, so `HEAD /` must reach
 * the `GET` fallback and serve the shell without a body, as Hono's `GET` route did.
 *
 * Hoisted functions that read `env` and the services only when called (CLAUDE.md "API import cycle"); both take
 * options so a test can point them at a throwaway `dist` directory or other origins.
 */
import { Effect, Layer, type Types } from "effect";
import { HttpRouter, type HttpServerRequest, type HttpServerResponse } from "effect/http";
import { env } from "../env.ts";
import { corsMiddleware } from "../middleware/cors.ts";
import { originGuardMiddleware } from "../middleware/originGuard.ts";
import { requestLogMiddleware } from "../middleware/requestLog.ts";
import { securityHeaderSet, securityHeadersMiddleware } from "../middleware/securityHeaders.ts";
import { staticFallback } from "../middleware/staticWeb.ts";

/** A global router middleware: it wraps the whole router, never fails with a typed error, answers with a response. */
export type GlobalMiddleware = (
  httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, HttpServerRequest.HttpServerRequest>;

/** What the global layer and the fallback read; every field defaults to the process configuration (`env`). */
export interface GlobalHttpOptions {
  /** The built web app's directory, or `null` (`env.webDistDir`). */
  readonly webDistDir?: string | null;
  /** The browser origins CORS and the origin guard trust (`env.webOrigins`). */
  readonly webOrigins?: readonly string[];
  /** Whether the request log runs (`!env.isTest`). */
  readonly requestLog?: boolean;
  /** Where the request log writes (`console.log`). */
  readonly logLine?: (line: string) => void;
}

/** The four global middlewares in registration order (P11). */
export function globalHttpLayer(options: GlobalHttpOptions = {}): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const webDistDir = options.webDistDir === undefined ? env.webDistDir : options.webDistDir;
      const webOrigins = options.webOrigins ?? env.webOrigins;
      const logging = options.requestLog ?? !env.isTest;
      const securityHeaders = yield* Effect.sync(() => securityHeaderSet(webDistDir));
      if (logging) yield* router.addGlobalMiddleware(requestLogMiddleware(options.logLine));
      yield* router.addGlobalMiddleware(securityHeadersMiddleware(securityHeaders));
      yield* router.addGlobalMiddleware(corsMiddleware(webOrigins));
      yield* router.addGlobalMiddleware(originGuardMiddleware(webOrigins));
    }),
  );
}

/** The fallback route (P11.5): the static web for a `GET`, the JSON route-unknown `404` for everything else. */
export function fallbackRoutesLayer(
  options: Pick<GlobalHttpOptions, "webDistDir"> = {},
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const webDistDir = options.webDistDir === undefined ? env.webDistDir : options.webDistDir;
  // Explicit methods, never `HEAD` and never `*` (see the file comment).
  return Layer.mergeAll(
    HttpRouter.add("GET", "*", staticFallback(webDistDir)),
    HttpRouter.add("POST", "*", staticFallback(webDistDir)),
    HttpRouter.add("PUT", "*", staticFallback(webDistDir)),
    HttpRouter.add("PATCH", "*", staticFallback(webDistDir)),
    HttpRouter.add("DELETE", "*", staticFallback(webDistDir)),
    HttpRouter.add("OPTIONS", "*", staticFallback(webDistDir)),
  );
}
