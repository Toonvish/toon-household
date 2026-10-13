/**
 * Negotiates the INTERFACE locale for one request. See docs/i18n.md §4 for why
 * this reads `Accept-Language` (CORS-safelisted, no preflight) rather than a
 * cookie or a custom header, and CLAUDE.md for why this is never
 * `recipes.language` (the CONTENT axis).
 */
import { negotiateLocale, type Locale } from "@toon/shared";
import type { Context, MiddlewareHandler } from "hono";
import { env } from "../env.ts";
import type { AppEnv } from "./types.ts";

export const localeMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("locale", negotiateLocale(c.req.header("accept-language"), env.defaultLocale));
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
