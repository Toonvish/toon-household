/**
 * CORS for `/api/*`: the semantics of the pre-E7 Hono 4.13.7 `cors()` with the options the pre-E7 `src/index.ts` passed, as
 * an Effect global middleware (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P11.3, deviation D6). Copied from
 * pre-E7 `hono/dist/middleware/cors/index.js`; never `HttpRouter.cors`, whose defaults (`*`) and header formatting
 * differ.
 *
 * The dev web app (`:5173` calling `:3001` with credentials) reads a 401 or a 422 only because these headers are on
 * EVERY `/api/*` response whatever its status, the boundary-rendered errors and the origin guard's `403` included, so
 * the non-preflight headers are a pre-response handler registered before anything inside runs. Observed on the pre-E7 Hono app
 * (`apps/api/test/http-contract.test.ts`, rows 3): the headers are sent also without an `Origin` request header
 * and also for a foreign one (the origin function falls back to the first `WEB_ORIGIN`), so the browser, not the
 * server, refuses a foreign origin; a preflight is answered with `204` here and never reaches a route.
 *
 * Pure helpers plus a factory that reads no imported binding until a request arrives (CLAUDE.md "API import cycle").
 */
import { Effect } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { GlobalMiddleware } from "../http/global.ts";
import { pathOf } from "../http/request.ts";

const ALLOW_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS";
const ALLOW_HEADERS = "Content-Type,Authorization";
const EXPOSE_HEADERS = "Content-Disposition,Location";
const MAX_AGE = "86400";

/** True for `/api` and everything below it (the pre-E7 Hono `app.use("/api/*")`). */
export function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

/** The origin function of the pre-E7 Hono app's `src/index.ts`: a listed origin is echoed, anything else gets the first one. */
export function allowedOrigin(webOrigins: readonly string[], origin: string): string {
  return webOrigins.includes(origin) ? origin : (webOrigins[0] ?? "");
}

/** The headers every non-preflight response carries (the pre-E7 Hono set them before `next()`). */
function simpleHeaders(webOrigins: readonly string[], origin: string): Record<string, string> {
  const allowOrigin = allowedOrigin(webOrigins, origin);
  return {
    ...(allowOrigin ? { "access-control-allow-origin": allowOrigin } : {}),
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": EXPOSE_HEADERS,
  };
}

/** The global CORS middleware for `/api/*` (`webOrigins` is `env.webOrigins`). */
export function corsMiddleware(webOrigins: readonly string[]): GlobalMiddleware {
  return (httpEffect) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
      if (!isApiPath(pathOf(request.originalUrl))) return httpEffect;
      const origin = request.headers["origin"] ?? "";
      const headers = simpleHeaders(webOrigins, origin);
      if (request.method === "OPTIONS") {
        // The pre-E7 Hono `Vary: Origin` is appended first, `Access-Control-Request-Headers` after the allow-headers line.
        return Effect.succeed(
          HttpServerResponse.empty({
            status: 204,
            statusText: "No Content",
            headers: {
              ...headers,
              vary: "Origin, Access-Control-Request-Headers",
              "access-control-max-age": MAX_AGE,
              "access-control-allow-methods": ALLOW_METHODS,
              "access-control-allow-headers": ALLOW_HEADERS,
            },
          }),
        );
      }
      return HttpEffect.withPreResponseHandler(httpEffect, (_request, response) => {
        const vary = response.headers["vary"];
        return Effect.succeed(
          HttpServerResponse.setHeaders(response, { ...headers, vary: vary ? `${vary}, Origin` : "Origin" }),
        );
      });
    });
}
