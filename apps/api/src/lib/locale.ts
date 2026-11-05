/**
 * Negotiates the INTERFACE locale for one request. See docs/i18n.md §4 for why
 * this reads `Accept-Language` (CORS-safelisted, no preflight) rather than a
 * cookie or a custom header, and CLAUDE.md for why this is never
 * `recipes.language` (the CONTENT axis).
 *
 * `negotiateRequestLocale` is the pure rule, shared by the Effect HTTP layer (`apps/api/src/http/request.ts`
 * `requestLocale`, `apps/api/src/http/response.ts` `errorResponse`; plan `docs/plans/e7-http-api.md` P4) and the Hono
 * section below until E7-T12 deletes it.
 */
import { negotiateLocale, type Locale } from "@toon/shared";
import { env } from "../env.ts";

/** The locale of a request whose `Accept-Language` header is `acceptLanguage` (absent: the configured default). */
export function negotiateRequestLocale(acceptLanguage: string | undefined): Locale {
  return negotiateLocale(acceptLanguage, env.defaultLocale);
}

/* Hono (E7 transition): E7-T12 deletes this section */
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.ts";

export const localeMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("locale", negotiateRequestLocale(c.req.header("accept-language")));
  await next();
};

/**
 * Falls back to the configured default if the middleware did not run —
 * `onError`/`notFound` can fire before an `app.use("*")` middleware has, so
 * this `??` is load-bearing. Do not "fix" `AppVariables.locale` to be
 * non-optional; that would make this dead code and invite someone to delete it.
 */
export function requestLocale(c: Context<AppEnv>): Locale {
  return c.get("locale") ?? env.defaultLocale;
}
