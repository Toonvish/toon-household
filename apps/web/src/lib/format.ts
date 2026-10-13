/**
 * Locale-aware display formatting. Pure functions — safe to use anywhere.
 * Domain formatting (durations, quantities, servings) is delegated to @toon/shared
 * so the API and the UI always agree.
 *
 * Formatters are PER-LOCALE SINGLETONS in a `Map`, resolved through the
 * ambient locale (`getLocale()`) rather than constructed per render —
 * constructing an `Intl` formatter costs tens of µs, and a recipe list
 * formats 24 dates. This file is called from OUTSIDE React just as often as
 * from inside it, so it reads the ambient locale directly rather than using
 * `useT()`/`useLocale()` (see docs/i18n.md §7 for the two-entry-point rule).
 */
import {
  INTL_LOCALE,
  isPlanDate,
  planDateToDate,
  type Locale,
} from "@toon/shared";
import { getLocale, translate } from "@/lib/i18n/store.ts";

interface Formatters {
  date: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
  relative: Intl.RelativeTimeFormat;
  /** The short relative style ("vor 10 Min." / "10 min ago") — see `formatRelativeShort`. */
  relativeShort: Intl.RelativeTimeFormat;
  /** The day-card eyebrow's weekday — see `formatWeekdayShort`. */
  weekdayShort: Intl.DateTimeFormat;
  /** The day-card eyebrow's day number — see `formatDayOfMonth`. */
  dayOfMonth: Intl.DateTimeFormat;
  /** The history panel's day header — see `formatShortWeekdayDate`. */
  shortWeekdayDate: Intl.DateTimeFormat;
}

const cache = new Map<Locale, Formatters>();

function build(intlLocale: string): Formatters {
  return {
    date: new Intl.DateTimeFormat(intlLocale, { day: "2-digit", month: "2-digit", year: "numeric" }),
    dateTime: new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    relative: new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" }),
    // "short", never "narrow" — narrow German renders minutes as "vor 10 m", unreadable.
    relativeShort: new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto", style: "short" }),
    weekdayShort: new Intl.DateTimeFormat(intlLocale, { weekday: "short" }),
    dayOfMonth: new Intl.DateTimeFormat(intlLocale, { day: "numeric" }),
    shortWeekdayDate: new Intl.DateTimeFormat(intlLocale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
  };
}

function formatters(): Formatters {
  const locale = getLocale();
  let entry = cache.get(locale);
  if (!entry) {
    entry = build(INTL_LOCALE[locale]);
    cache.set(locale, entry);
  }
  return entry;
}

/** "03.08.2026" ("de") / "03/08/2026" ("en", en-GB order) */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return translate("common.common.dash");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return translate("common.common.dash");
  return formatters().date.format(date);
}

/** "03.08.2026, 15:48" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return translate("common.common.dash");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return translate("common.common.dash");
  return formatters().dateTime.format(date);
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["minute", 60],
  ["hour", 3600],
  ["day", 86_400],
  ["week", 604_800],
  ["month", 2_629_800],
  ["year", 31_557_600],
];

/**
 * Shared by `formatRelative` and `formatRelativeShort`: parses `iso`, applies the
 * `< 45 s -> justNow` / nullish-or-`NaN` -> dash guards, and picks the coarsest unit
 * the elapsed time clears — everything except which `Intl.RelativeTimeFormat`
 * instance renders the final number, which the caller supplies.
 */
function relativeParts(iso: string | null | undefined): { value: number; unit: Intl.RelativeTimeFormatUnit } | string {
  if (!iso) return translate("common.common.dash");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return translate("common.common.dash");
  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const absolute = Math.abs(diffSeconds);
  if (absolute < 45) return translate("common.time.justNow");
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let divisor = 60;
  for (const [candidateUnit, candidateDivisor] of RELATIVE_STEPS) {
    if (absolute >= candidateDivisor) {
      unit = candidateUnit;
      divisor = candidateDivisor;
    }
  }
  return { value: Math.round(diffSeconds / divisor), unit };
}

/** "vor 3 Tagen" / "gerade eben" ("de"); "3 days ago" / "just now" ("en") */
export function formatRelative(iso: string | null | undefined): string {
  const parts = relativeParts(iso);
  if (typeof parts === "string") return parts;
  return formatters().relative.format(parts.value, parts.unit);
}

/**
 * "vor 10 Min." / "vor 2 Std." ("de"); "10 min ago" / "2 hr ago" ("en") — the compact
 * style for bought rows and the phone stat grid. `style: "short"`, never `"narrow"`:
 * narrow German renders minutes as "vor 10 m", which is unreadable.
 */
export function formatRelativeShort(iso: string | null | undefined): string {
  const parts = relativeParts(iso);
  if (typeof parts === "string") return parts;
  return formatters().relativeShort.format(parts.value, parts.unit);
}

/**
 * A bare `PlanDate` ("YYYY-MM-DD") parses as UTC midnight, which renders as the
 * PREVIOUS day in every timezone west of Greenwich — the same trap `calendar.ts`'s
 * `planDateToDate()` exists to avoid. The three weekday/day formatters below take
 * either a `PlanDate` or a full ISO instant (i18n-keys.md §3.3 passes
 * `formatShortWeekdayDate` a plain day key), so they route through here instead of
 * `new Date(iso)` directly.
 */
function toDate(iso: string): Date {
  return isPlanDate(iso) ? planDateToDate(iso) : new Date(iso);
}

/** "So" ("de") / "Sun" ("en") — the day-card eyebrow's weekday. */
export function formatWeekdayShort(iso: string): string {
  const date = toDate(iso);
  if (Number.isNaN(date.getTime())) return translate("common.common.dash");
  return formatters().weekdayShort.format(date);
}

/** "30" — the day-card eyebrow's day number, no separator. */
export function formatDayOfMonth(iso: string): string {
  const date = toDate(iso);
  if (Number.isNaN(date.getTime())) return translate("common.common.dash");
  return formatters().dayOfMonth.format(date);
}

/** "So., 30. Aug." ("de") / "Sun 30 Aug" ("en") — the history panel's day header. */
export function formatShortWeekdayDate(iso: string): string {
  const date = toDate(iso);
  if (Number.isNaN(date.getTime())) return translate("common.common.dash");
  return formatters().shortWeekdayDate.format(date);
}

/**
 * A `PlanDate` as the short weekday date, plus the year when it differs from
 * `relativeTo`'s — "Mo., 14. Sep." vs "14.09.2025", so an entry from last year
 * never reads as this year's.
 */
export function formatPlanDateNear(value: string, relativeTo: string): string {
  if (value.slice(0, 4) === relativeTo.slice(0, 4)) return formatShortWeekdayDate(value);
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return translate("common.common.dash");
  return formatters().date.format(date);
}

/** "1,5 MB" ("de") / "1.5 MB" ("en") */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString(INTL_LOCALE[getLocale()], { maximumFractionDigits: 1 })} MB`;
}

/** "Erika Mustermann" -> "EM" (max 2 letters, always uppercase). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * A URL that is safe to hand to an `href`, or undefined.
 *
 * DEFENCE IN DEPTH: `CreateRecipeRequest.sourceUrl` now rejects anything that is
 * not http(s), but a row written before that (or by a future importer bug) must
 * still never produce a live `javascript:` link — clicking one would run the
 * attacker's script on the app origin with the victim's session. Every component
 * that renders a server-supplied link goes through here.
 */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const protocol = new URL(trimmed, window.location.origin).protocol;
    if (protocol !== "http:" && protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return trimmed;
}

/** Domain of a source URL, without "www.". */
export function hostFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Cuts text on a word boundary and appends an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// `roleLabels` and `difficultyLabels` are GONE (docs/i18n.md §10 rule 8). A map of
// literals frozen at import time cannot follow a locale switch, and both were still
// German after the port. Their wire KEYS are unchanged — the labels now live in the
// catalogs behind `features/groups/lib/roleLabels.ts` (`groups.role.*`) and
// `features/recipes/lib/difficultyLabels.ts` (`recipes.difficulty.*`), resolved with
// `t()` at render time. Do not re-add a label map here.

/**
 * Readable text colour for a user-chosen tag colour (#rrggbb).
 * Uses the perceived-luminance rule, so both dark and light tags stay legible.
 */
export function readableTextColor(hex: string | null | undefined): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match?.[1]) return "inherit";
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#241d18" : "#ffffff";
}

// `plural()` is GONE (docs/i18n.md §3/§10 rule 4): its ~15+ call sites become
// plural catalog entries (`t("…", { count })`), each ported by the namespace
// that owns the screen. Do not re-add a two-form helper here.
