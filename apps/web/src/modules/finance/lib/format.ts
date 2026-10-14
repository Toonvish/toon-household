/**
 * The finance module's display formatters: F `lib/format.ts`, whole (M3 decision 10). Its
 * `formatDate` / `formatDateTime` (locale parameter, `"–"` fallback, `Date` input) and
 * `initials` shadow the core's of the same names inside this module; every other core
 * formatter is re-exported unchanged.
 */
export * from "@/lib/format";

/**
 * Locale-aware display formatting. Pure functions — safe to use anywhere.
 * Money and quota formatting delegate their FRACTION to `@toon/shared`
 * (`formatQuote`), so the API and the UI would agree even if the API ever
 * rendered a percentage itself — but cents are formatted here, per viewer
 * locale, from the integer the wire always sends. **Never format from a
 * float, never `parseFloat` on user input** (CLAUDE.md's one rule).
 *
 * Formatters are PER-LOCALE SINGLETONS in a `Map`, resolved through the
 * ambient locale (`getLocale()`) rather than constructed per render —
 * constructing an `Intl` formatter costs tens of µs, and a transaction list
 * formats dozens of amounts and dates per screen.
 */
import { CENTS_PER_EURO, formatQuote, INTL_LOCALE, type Locale } from "@toon/shared";
import { getLocale } from "@/lib/i18n/store.ts";

interface Formatters {
  currency: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
  month: Intl.DateTimeFormat;
}

const cache = new Map<Locale, Formatters>();

function build(intlLocale: string): Formatters {
  return {
    currency: new Intl.NumberFormat(intlLocale, { style: "currency", currency: "EUR" }),
    date: new Intl.DateTimeFormat(intlLocale, { day: "2-digit", month: "2-digit", year: "numeric" }),
    dateTime: new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    month: new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }),
  };
}

function formatters(locale: Locale = getLocale()): Formatters {
  let entry = cache.get(locale);
  if (!entry) {
    entry = build(INTL_LOCALE[locale]);
    cache.set(locale, entry);
  }
  return entry;
}

/** Signed integer cents -> `"12,50 €"` (de-DE) / `"€12.50"` (en-GB). Always EUR — the app has one currency. */
export function formatCurrency(cents: number, locale: Locale = getLocale()): string {
  return formatters(locale).currency.format(cents / CENTS_PER_EURO);
}

/** `"09.08.2026"` (de) / `"09/08/2026"` (en, en-GB order). */
export function formatDate(iso: string | Date | null | undefined, locale: Locale = getLocale()): string {
  if (!iso) return "–";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "–";
  return formatters(locale).date.format(date);
}

/** `"09.08.2026, 13:04"`. */
export function formatDateTime(iso: string | Date | null | undefined, locale: Locale = getLocale()): string {
  if (!iso) return "–";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "–";
  return formatters(locale).dateTime.format(date);
}

/** `'2026-08'` -> `"August 2026"` (de) / `"August 2026"` (en). */
export function formatPeriod(period: string, locale: Locale = getLocale()): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return formatters(locale).month.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** `quoteNumerator/quoteDenominator` -> `"23,75 %"` — never an intermediate float. */
export function formatPercent(numerator: number, denominator: number, locale: Locale = getLocale()): string {
  return formatQuote(numerator, denominator, INTL_LOCALE[locale] as "de-DE" | "en-GB");
}

/** `"Erika Mustermann"` -> `"EM"` (max 2 letters, uppercase) — avatar-style fallback initials. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
