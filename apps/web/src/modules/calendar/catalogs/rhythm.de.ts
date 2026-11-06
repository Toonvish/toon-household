import type { NamespaceCatalog } from "@toon/shared";

/** A series' rhythm in words (`lib/rhythm.ts`; design §4.4, §4.5). */
export const calendarRhythmDe = {
  "calendar.rhythm.once": "einmalig",
  "calendar.rhythm.daily": { one: "täglich", other: "alle {count} Tage" },
  "calendar.rhythm.weekly": { one: "jeden {days}", other: "alle {count} Wochen: {days}" },
  "calendar.rhythm.monthly": { one: "monatlich am {day}.", other: "alle {count} Monate am {day}." },
  "calendar.rhythm.yearly": { one: "jährlich am {date}", other: "alle {count} Jahre am {date}" },
  "calendar.rhythm.until": "{rhythm} bis {date}",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarRhythmCatalog = typeof calendarRhythmDe;
