/**
 * The calendar module's web catalogs (SPEC D10, ADR 0016): one literal-typed `as const` object per locale, spread
 * from the namespace files. NO type annotation on either object: `modules/catalogs.ts` spreads them into
 * `MODULE_CATALOGS_DE/EN`, and an index-signature type here would widen `MessageKey` to `string` (CLAUDE.md
 * "`MessageKey` must stay a literal union"). A new namespace file is one more spread in both objects.
 */
import { calendarCommonDe } from "./common.de.ts";
import { calendarCommonEn } from "./common.en.ts";
import { calendarNavDe } from "./nav.de.ts";
import { calendarNavEn } from "./nav.en.ts";

export const calendarDe = {
  ...calendarCommonDe,
  ...calendarNavDe,
} as const;

export const calendarEn = {
  ...calendarCommonEn,
  ...calendarNavEn,
} as const;
