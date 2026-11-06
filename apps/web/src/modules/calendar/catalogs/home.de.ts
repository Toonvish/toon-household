import type { NamespaceCatalog } from "@toon/shared";

/** The Home card (design §4.7). */
export const calendarHomeDe = {
  "calendar.home.empty": "Heute und morgen steht nichts an.",
  "calendar.home.open": "Kalender",
  "calendar.home.more": { one: "und 1 weiterer Eintrag", other: "und {count} weitere Einträge" },
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarHomeCatalog = typeof calendarHomeDe;
