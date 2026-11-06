import type { NamespaceCatalog } from "@toon/shared";

/** The calendar module's shared strings (new German, ADR 0016: `NEW_GERMAN_NAMESPACES` admits `calendar.`). */
export const calendarCommonDe = {
  "calendar.module.name": "Kalender",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarCommonCatalog = typeof calendarCommonDe;
