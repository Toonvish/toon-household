/**
 * The translation runtime: interpolation, plural selection, missing-key
 * behaviour and the one sanctioned way to render a key that arrived off the
 * wire (`resolveWireKey`, §2). Pure — `Intl.PluralRules` only, no `window`, no
 * `document`, no `localStorage`.
 */
import { INTL_LOCALE, type Locale } from "./locale.ts";
import type { CatalogEntry, MessageValues, PluralForms, Translator } from "./types.ts";

function isPluralForms(entry: CatalogEntry): entry is PluralForms {
  return typeof entry !== "string";
}

/** Replaces every `{name}` with `values.name`, left untouched if absent. */
export function interpolate(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

const pluralRulesCache = new Map<Locale, Intl.PluralRules>();

/** Cached `Intl.PluralRules` per locale — construction is not free (§7). */
export function pluralRulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(INTL_LOCALE[locale]);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

function resolvePlural(entry: PluralForms, locale: Locale, count: number): string {
  const category = pluralRulesFor(locale).select(count);
  return entry[category] ?? entry.other;
}

const warnedMissingKeys = new Set<string>();

function isDev(): boolean {
  // Web (Vite) exposes import.meta.env.DEV; the API sets NODE_ENV=development.
  // Neither global exists in the other runtime, so both checks stay guarded.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = import.meta as unknown as { env?: { DEV?: boolean } };
    if (meta?.env?.DEV) return true;
  } catch {
    /* not bundled by Vite */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (globalThis as any).process as { env?: { NODE_ENV?: string } } | undefined;
    if (proc?.env?.NODE_ENV === "development") return true;
  } catch {
    /* no `process` in the browser */
  }
  return false;
}

/**
 * Renders one catalog entry. Never throws — a missing key degrades to the key
 * itself (never to a blank screen inside `ErrorBoundary`), and warns once per
 * key in development.
 */
function renderEntry(
  catalog: Record<string, CatalogEntry>,
  locale: Locale,
  key: string,
  values?: MessageValues,
): string {
  const entry = catalog[key];
  if (entry === undefined) {
    const warnKey = `${locale}:${key}`;
    if (isDev() && !warnedMissingKeys.has(warnKey)) {
      warnedMissingKeys.add(warnKey);
      console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
    }
    return key;
  }
  if (isPluralForms(entry)) {
    const count = typeof values?.count === "number" ? values.count : 0;
    return interpolate(resolvePlural(entry, locale, count), values);
  }
  return interpolate(entry, values);
}

/** Builds a typed `t()` bound to one catalog + locale (§3). */
export function createTranslator<C extends Record<string, CatalogEntry>>(
  catalog: C,
  locale: Locale,
): Translator<C> {
  return ((key: string, values?: MessageValues) =>
    renderEntry(catalog, locale, key, values)) as Translator<C>;
}

/** Whether `key` exists in `catalog` — the guard a wire-key resolver needs. */
export function hasKey(catalog: Record<string, CatalogEntry>, key: string): boolean {
  return Object.hasOwn(catalog, key);
}

/**
 * Resolves a key against a specific catalog, or `undefined` when the catalog
 * does not know it. This is the primitive behind every "translate a key that
 * came off the wire" helper (§2/§4) — `resolveWireKey` in `i18n/catalogs/index.ts`
 * closes over `SERVER_CATALOGS` so its call sites need only `(locale, key,
 * values)`. Never returns the bare key on a miss like `renderEntry` does: the
 * caller of a wire-key resolver must fall back to the wire's own `message`,
 * never to the raw dotted key.
 */
export function resolveCatalogKey(
  catalog: Record<string, CatalogEntry>,
  locale: Locale,
  key: string,
  values?: MessageValues,
): string | undefined {
  if (!hasKey(catalog, key)) return undefined;
  return renderEntry(catalog, locale, key, values);
}
