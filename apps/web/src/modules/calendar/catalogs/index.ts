/**
 * The calendar module's web catalogs (SPEC D10, ADR 0016): one literal-typed `as const` object per locale, spread
 * from the namespace files. NO type annotation on either object: `modules/catalogs.ts` spreads them into
 * `MODULE_CATALOGS_DE/EN`, and an index-signature type here would widen `MessageKey` to `string` (CLAUDE.md
 * "`MessageKey` must stay a literal union"). A new namespace file is one more spread in both objects.
 */
import { calendarAgendaDe } from "./agenda.de.ts";
import { calendarAgendaEn } from "./agenda.en.ts";
import { calendarCarsDe } from "./cars.de.ts";
import { calendarCarsEn } from "./cars.en.ts";
import { calendarCommonDe } from "./common.de.ts";
import { calendarCommonEn } from "./common.en.ts";
import { calendarEntriesDe } from "./entries.de.ts";
import { calendarEntriesEn } from "./entries.en.ts";
import { calendarHomeDe } from "./home.de.ts";
import { calendarHomeEn } from "./home.en.ts";
import { calendarMonthDe } from "./month.de.ts";
import { calendarMonthEn } from "./month.en.ts";
import { calendarNavDe } from "./nav.de.ts";
import { calendarNavEn } from "./nav.en.ts";
import { calendarRhythmDe } from "./rhythm.de.ts";
import { calendarRhythmEn } from "./rhythm.en.ts";
import { calendarTasksDe } from "./tasks.de.ts";
import { calendarTasksEn } from "./tasks.en.ts";
import { calendarWasteDe } from "./waste.de.ts";
import { calendarWasteEn } from "./waste.en.ts";

export const calendarDe = {
  ...calendarCommonDe,
  ...calendarNavDe,
  ...calendarRhythmDe,
  ...calendarAgendaDe,
  ...calendarHomeDe,
  ...calendarMonthDe,
  ...calendarTasksDe,
  ...calendarEntriesDe,
  ...calendarCarsDe,
  ...calendarWasteDe,
} as const;

export const calendarEn = {
  ...calendarCommonEn,
  ...calendarNavEn,
  ...calendarRhythmEn,
  ...calendarAgendaEn,
  ...calendarHomeEn,
  ...calendarMonthEn,
  ...calendarTasksEn,
  ...calendarEntriesEn,
  ...calendarCarsEn,
  ...calendarWasteEn,
} as const;
