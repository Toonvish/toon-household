/**
 * The set of interface locales this app supports, and how a request/device
 * negotiates one. Pure — no I/O, no `Intl` formatter construction (that lives
 * in the consumer, see apps/web/src/lib/format.ts).
 *
 * This is the INTERFACE language axis, not the CONTENT language axis: see
 * CLAUDE.md's "interface vs content language" gotcha. `recipes.language`,
 * `TESSERACT_LANGS` and the German unit vocabulary are a different thing and
 * must never be driven by this module.
 */

/** Interface locales, in priority order for negotiation ties. */
export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** The locale a fresh install / an unconfigured deployment uses. */
export const DEFAULT_LOCALE: Locale = "de";

/** `Intl` locale tag per app locale — `en` is `en-GB`, not bare `en` (§7). */
export const INTL_LOCALE: Record<Locale, string> = {
  de: "de-DE",
  en: "en-GB",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a supported locale out of an `Accept-Language` header (or
 * `navigator.languages.join(",")`), falling back to `fallback` when nothing in
 * the header matches a supported locale.
 *
 * Deliberately simple: split on commas, strip the `;q=` weight (the list is
 * already sent in preference order, so a full weighted parse buys nothing),
 * take the primary language subtag before the first `-`, and return the first
 * one that is one of {@link LOCALES}.
 */
export function negotiateLocale(
  acceptLanguageHeader: string | null | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  if (!acceptLanguageHeader) return fallback;
  for (const part of acceptLanguageHeader.split(",")) {
    const tag = part.split(";")[0]?.trim();
    if (!tag) continue;
    const primary = tag.split("-")[0]?.toLowerCase();
    if (primary && isLocale(primary)) return primary;
  }
  return fallback;
}
