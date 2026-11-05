/**
 * Same-origin guard for every state-changing `/api/*` request — the API's CSRF
 * defence, in depth behind the `SameSite=Lax` session cookie (toon-finance gotcha 66,
 * 1715207; plan m3b decision 15).
 *
 * `Lax` alone stops a cross-SITE form post from carrying the cookie, but it says
 * nothing about a sibling on the same site: sibling apps on one registrable domain existed
 * under toon-edge, and the stack's own Caddy (docker/Caddyfile, SPEC D11) still answers the
 * old hostnames with redirects during the cutover, so a script running on another app's
 * origin is "same-site" for the browser and the household cookie rides along. And a body
 * parser that reads JSON out of any content type would accept a `text/plain` form
 * post, which is why `readJson` in core/routes/auth.ts also demands
 * `Content-Type: application/json`.
 *
 * The rule, in order:
 *
 *   0. GET/HEAD/OPTIONS are never checked: they must be side-effect-free anyway, and
 *      blocking them would only break bookmarks, the service worker and preflights.
 *   1. An `Origin` that is one of `WEB_ORIGIN`'s entries passes (H-adapted). H's dev
 *      default runs the web app on `:5173` and lets it call the API on `:3001`
 *      directly (CORS with credentials, see index.ts): that is the SAME SITE, so the
 *      browser sends `Sec-Fetch-Site: same-site`, which F's rule refuses. An origin
 *      the operator listed is exactly the one CORS already trusts.
 *   2. `Sec-Fetch-Site: cross-site | same-site` -> 403 (`same-origin` and `none`, a
 *      user-typed navigation, pass).
 *   3. `Origin: null` (a sandboxed frame, a `data:` page) -> 403.
 *   4. `Origin` present and its HOST differs from the request's own host -> 403. Only
 *      the host is compared, never the scheme: the edge proxy terminates TLS, so the
 *      browser says `https://…` while the API sees the plain-http URL Caddy forwarded.
 *   5. No `Origin` at all (curl, the test harness, server-to-server) passes: a browser
 *      always sends `Origin` on a cross-origin unsafe request, the only case this file
 *      is for.
 *
 * Pure functions plus a factory that reads no imported binding until a request arrives (CLAUDE.md "API import cycle", plan e2
 * P12). The refusal is the only effect: the Effect global middleware (plan `docs/plans/e7-http-api.md` P11.4, deviation
 * D6) answers `errorResponse(new Forbidden(...))` before routing, so it renders through the one boundary renderer.
 */
import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import type { GlobalMiddleware } from "../http/global.ts";
import { pathOf } from "../http/request.ts";
import { errorResponse } from "../http/response.ts";
import { Forbidden } from "../lib/errors.ts";
import { isApiPath } from "./cors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** `scheme://host[:port]` of a URL, lower-cased; null when it does not parse. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? null : parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export interface OriginCheckRequest {
  method: string;
  url: string;
  header: (name: string) => string | undefined;
}

/**
 * True when a browser-originated unsafe request comes from a foreign origin.
 * `trustedOrigins` are `env.webOrigins` (WEB_ORIGIN, comma-separated).
 */
export function isForeignOrigin(
  request: OriginCheckRequest,
  trustedOrigins: readonly string[] = [],
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

  const origin = request.header("origin");
  if (origin && origin !== "null") {
    const normalised = originOf(origin);
    if (
      normalised !== null &&
      trustedOrigins.some((trusted) => originOf(trusted) === normalised)
    ) {
      return false;
    }
  }

  const fetchSite = request.header("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") return true;

  if (!origin || origin === "null") return origin === "null";

  const originHost = hostOf(origin);
  const requestHost = hostOf(request.url);
  if (originHost === null || requestHost === null) return true;
  return originHost !== requestHost;
}

/**
 * The global middleware for `/api/*`: 403 `forbidden` (`server.error.originMismatch`) for a foreign-origin unsafe
 * request. The request host comes from the full request URL (`originalUrl`, as `c.req.url` was).
 */
export function originGuardMiddleware(trustedOrigins: readonly string[]): GlobalMiddleware {
  return (httpEffect) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      isApiPath(pathOf(request.originalUrl)) &&
      isForeignOrigin(
        { method: request.method, url: request.originalUrl, header: (name) => request.headers[name.toLowerCase()] },
        trustedOrigins,
      )
        ? errorResponse(new Forbidden({ text: "server.error.originMismatch" }))
        : httpEffect,
    );
}

/* Hono (E7 transition): E7-T12 deletes this section */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/types.ts";
import { runtime } from "../runtime.ts";

/** Hono middleware: 403 `forbidden` (`server.error.originMismatch`) for a foreign-origin unsafe request. */
export function originGuard(trustedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (
      isForeignOrigin(
        { method: c.req.method, url: c.req.url, header: (name) => c.req.header(name) },
        trustedOrigins,
      )
    ) {
      await runtime.runPromise(Effect.fail(new Forbidden({ text: "server.error.originMismatch" })));
    }
    await next();
  };
}
