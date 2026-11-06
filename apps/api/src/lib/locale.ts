/**
 * Negotiates the INTERFACE locale for one request. See docs/i18n.md §4 for why
 * this reads `Accept-Language` (CORS-safelisted, no preflight) rather than a
 * cookie or a custom header, and CLAUDE.md for why this is never
 * `recipes.language` (the CONTENT axis).
 *
 * `negotiateRequestLocale` is the pure rule, shared by the Effect HTTP layer (`apps/api/src/http/request.ts`
 * `requestLocale`, `apps/api/src/http/response.ts` `errorResponse`; plan `docs/plans/e7-http-api.md` P4), where the pre-E7 Hono
 * locale middleware used it too.
 */
import { negotiateLocale, type Locale } from "@toon/shared";
import { env } from "../env.ts";

/** The locale of a request whose `Accept-Language` header is `acceptLanguage` (absent: the configured default). */
export function negotiateRequestLocale(acceptLanguage: string | undefined): Locale {
  return negotiateLocale(acceptLanguage, env.defaultLocale);
}
