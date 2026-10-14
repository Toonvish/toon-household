/**
 * Duration + servings parsing. Pure, German-first, no I/O.
 * Handles ISO-8601 (schema.org `prepTime: "PT1H15M"`) and free German text.
 */
import { DEFAULT_LOCALE, type Locale } from "../../core/i18n/locale.ts";
import { SERVER_CATALOGS } from "../../core/i18n/catalogs/index.ts";
import { resolveCatalogKey } from "../../core/i18n/translate.ts";
import { QUANTITY_TOKEN, parseNumberToken } from "./numbers.ts";
import type { Servings } from "./schemas/import.ts";

const QT = QUANTITY_TOKEN;

const ISO_RE =
  /^P(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;

/** Spelled-out fragments that appear in German time phrases. */
const WORD_AMOUNTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\banderthalb\b/giu, "1,5"],
  [/\beineinhalb\b/giu, "1,5"],
  [/\bzweieinhalb\b/giu, "2,5"],
  [/\bdreiviertel\b/giu, "0,75"],
  [/\bdrei\s*viertel\b/giu, "0,75"],
  [/\beine?\s+halbe?\b/giu, "0,5"],
  [/\bhalbe?\b/giu, "0,5"],
  [/\beine?n?\b/giu, "1"],
  [/\bzwei\b/giu, "2"],
  [/\bdrei\b/giu, "3"],
  [/\bvier\b/giu, "4"],
  [/\bfünf\b/giu, "5"],
  [/\bsechs\b/giu, "6"],
  [/\bzehn\b/giu, "10"],
  [/\bzwölf\b/giu, "12"],
  [/\btwenty\b/giu, "20"],
  [/\bhalf\s+an?\b/giu, "0,5"],
];

const TIME_UNIT_MINUTES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:tage?n?|days?|d)$/iu, 1440],
  [/^(?:stunden?|stdn?|std|hours?|hrs?|hr|h)$/iu, 60],
  [/^(?:minuten?|minutes?|mins?|min|m)$/iu, 1],
  [/^(?:sekunden?|seconds?|sek|secs?|sec|s)$/iu, 1 / 60],
];

function unitToMinutes(word: string): number | undefined {
  const cleaned = word.replace(/\.$/, "");
  for (const [pattern, minutes] of TIME_UNIT_MINUTES) {
    if (pattern.test(cleaned)) return minutes;
  }
  return undefined;
}

/**
 * Parses a duration into MINUTES.
 *
 * Accepts ISO-8601 ("PT30M", "PT1H15M", "P0DT0H45M"), German text
 * ("30 Minuten", "1 Std. 15 Min.", "1½ Stunden", "eine halbe Stunde"),
 * English text ("45 minutes", "1 hour 30 min"), ranges ("20-25 Minuten" =>
 * upper bound 25) and bare numbers ("30" => 30).
 *
 * Returns undefined when no duration can be found.
 */
export function parseDuration(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : undefined;
  }

  const input = raw.replace(/[   ]/g, " ").trim();
  if (input.length === 0) return undefined;

  // --- ISO-8601 -------------------------------------------------------------
  const iso = ISO_RE.exec(input);
  if (iso && iso.slice(1).some((part) => part !== undefined)) {
    const num = (value: string | undefined): number => (value ? Number(value.replace(",", ".")) : 0);
    const minutes =
      num(iso[1]) * 10080 + num(iso[2]) * 1440 + num(iso[3]) * 60 + num(iso[4]) + num(iso[5]) / 60;
    return Math.round(minutes);
  }

  // --- free text ------------------------------------------------------------
  let text = input.toLowerCase();
  for (const [pattern, replacement] of WORD_AMOUNTS) text = text.replace(pattern, replacement);
  // ranges -> upper bound ("20-25 minuten" => "25 minuten")
  const rangeRe = new RegExp(`(${QT})\\s*(?:-|–|—|bis|to)\\s*(${QT})`, "giu");
  text = text.replace(rangeRe, (_match, low: string, high: string) => {
    const lowValue = parseNumberToken(low);
    const highValue = parseNumberToken(high);
    if (lowValue === undefined || highValue === undefined) return high;
    return String(Math.max(lowValue, highValue)).replace(".", ",");
  });

  const pairRe = new RegExp(`(${QT})\\s*([\\p{L}]+\\.?)`, "giu");
  let total = 0;
  let found = false;
  for (const match of text.matchAll(pairRe)) {
    const amount = parseNumberToken(match[1]!);
    const minutes = unitToMinutes(match[2]!);
    if (amount === undefined || minutes === undefined) continue;
    total += amount * minutes;
    found = true;
  }
  if (found) return Math.round(total);

  // bare number => minutes
  const bare = parseNumberToken(text.replace(/\s*(?:min\.?|minuten?)\s*$/iu, "").trim());
  if (bare !== undefined && bare >= 0) return Math.round(bare);

  return undefined;
}

/**
 * Renders minutes as text: 95 => "1 Std. 35 Min." (`de`) / "1 hr 35 min" (`en`).
 *
 * This is the INTERFACE half of this file — it renders words the codebase
 * generates, not German it read out of a recipe (`parseDuration`, right above,
 * is the CONTENT half and stays German-only; see docs/i18n.md §7). Defaults to
 * `DEFAULT_LOCALE` so every call site that predates locale-awareness — and
 * `test/duration.test.ts`'s six pinned outputs — keeps behaving exactly as
 * before.
 */
export function formatDuration(minutes: number | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return "";
  const total = Math.round(minutes);
  const catalog = SERVER_CATALOGS[locale] ?? SERVER_CATALOGS[DEFAULT_LOCALE];
  // resolveCatalogKey, not the strongly-typed createTranslator: the catalog
  // here is picked at RUNTIME from a Locale, so its type is a union of both
  // locales' catalogs rather than one fixed shape — exactly the case
  // Translator<C>'s generic inference is not built for (§3's "budget and
  // escape hatch"). The keys below are fixed string literals we wrote
  // ourselves, so the loss of compile-time placeholder checking here is safe.
  const render = (key: string, values?: Record<string, string | number>) =>
    resolveCatalogKey(catalog, locale, key, values) ?? key;
  if (total === 0) return render("server.duration.zero");
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(render("server.duration.days", { count: days }));
  if (hours > 0) parts.push(render("server.duration.hours", { count: hours }));
  if (mins > 0) parts.push(render("server.duration.minutes", { count: mins }));
  return parts.join(" ");
}

/** Nouns we canonicalise in servings output. */
const SERVINGS_UNIT_ALIASES: Record<string, string> = {
  portion: "Portionen",
  portionen: "Portionen",
  serving: "Portionen",
  servings: "Portionen",
  serves: "Portionen",
  person: "Personen",
  personen: "Personen",
  people: "Personen",
  stück: "Stück",
  stueck: "Stück",
  stk: "Stück",
  piece: "Stück",
  pieces: "Stück",
};

/**
 * A number followed by one of these is a weight/volume yield, not a servings
 * count ("500 g" is not "500 Portionen") — parseServings gives up.
 */
const MEASURE_WORDS = new Set(["g", "gr", "gramm", "kg", "ml", "cl", "l", "liter", "litre", "cm", "mm", "oz", "lb"]);

/** Words that are never a servings noun but do not invalidate the number. */
const SERVINGS_STOPWORDS = new Set([
  "min",
  "minuten",
  "std",
  "stunden",
  "el",
  "tl",
  "bis",
  "und",
  "à",
  "a",
  "x",
  "ca",
]);

const SERVINGS_NOUN_BEFORE_RE = /([\p{L}äöüß]+)\s*[:=]?\s*$/u;

function canonicalServingsUnit(word: string): string {
  const key = word.toLowerCase().replace(/[.:,]$/, "");
  const alias = SERVINGS_UNIT_ALIASES[key];
  if (alias) return alias;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Parses a servings/yield string.
 *
 * "4 Portionen" -> { amount: 4, unit: "Portionen" }
 * "12 Stück"    -> { amount: 12, unit: "Stück" }
 * "für 4 Personen" -> { amount: 4, unit: "Personen" }
 * "4-6 Portionen"  -> { amount: 6, unit: "Portionen" }  (upper bound)
 * "24 Muffins"  -> { amount: 24, unit: "Muffins" }
 * "Portionen: 4" / "serves 4" / "4" -> { amount: 4, unit: "Portionen" }
 *
 * Returns undefined when there is no usable number.
 */
export function parseServings(raw: string | number | null | undefined): Servings | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? { amount: raw, unit: "Portionen" } : undefined;
  }

  const input = raw.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
  if (input.length === 0) return undefined;

  // number (or range) plus optional following noun
  const numberRe = new RegExp(`(${QT})(?:\\s*(?:-|–|—|bis|to)\\s*(${QT}))?`, "iu");
  const match = numberRe.exec(input);
  if (!match || match.index === undefined) return undefined;

  const low = parseNumberToken(match[1]!);
  const high = match[2] ? parseNumberToken(match[2]) : undefined;
  const amount = high !== undefined ? Math.max(low ?? 0, high) : low;
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0 || amount > 10000) return undefined;

  const after = input.slice(match.index + match[0].length).trim();
  const before = input.slice(0, match.index).trim();

  let unit = "Portionen";
  const afterNoun = /^([\p{L}äöüß]+)/u.exec(after);
  if (afterNoun && MEASURE_WORDS.has(afterNoun[1]!.toLowerCase())) return undefined;
  if (afterNoun && !SERVINGS_STOPWORDS.has(afterNoun[1]!.toLowerCase())) {
    unit = canonicalServingsUnit(afterNoun[1]!);
  } else {
    const beforeNoun = SERVINGS_NOUN_BEFORE_RE.exec(before);
    if (beforeNoun && !SERVINGS_STOPWORDS.has(beforeNoun[1]!.toLowerCase())) {
      const candidate = beforeNoun[1]!.toLowerCase();
      if (candidate !== "für" && candidate !== "for" && candidate !== "ca") {
        unit = canonicalServingsUnit(beforeNoun[1]!);
      }
    }
  }

  return { amount: Math.round(amount * 100) / 100, unit };
}

/** Renders servings for the UI: { amount: 4, unit: "Portionen" } -> "4 Portionen". */
export function formatServings(servings: Servings | null | undefined): string {
  if (!servings) return "";
  return `${servings.amount} ${servings.unit}`.trim();
}
