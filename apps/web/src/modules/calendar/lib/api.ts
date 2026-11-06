/**
 * The calendar module's API (docs/modules/calendar.md §2, plan m8 section 5.2, 5.4). This file adds no transport
 * of its own (SPEC §2): every request is a member of {@link CalendarApi}, built on the helpers of `@/lib/api`
 * (`getJson`, `sendJson`, `sendForm`, `sendVoid`), run on the web's one runtime, and decoded with the shared
 * `Calendar…Schema` (docs/EFFECT.md E11). The exported functions are `Promise` facades over `runPromise`.
 *
 * FOUNDATION SKELETON (M8-T03): the base-path helper only; the lane web (M8-T13) adds one member per endpoint of
 * plan section 5.2 (`fetchOccurrences`, `setOccurrenceStatus`, `fetchEntries`, `fetchEntry`, `createEntry`,
 * `updateEntry`, `deleteEntry`, `fetchResources`, `createResource`, `updateResource`, `deleteResource`,
 * `fetchWaste`, `putWasteSettings`, `previewWasteFromUrl`, `previewWasteFromFile`, `importWasteFromUrl`,
 * `importWasteFromFile`, `deleteWasteImport`).
 *
 * `export *` re-exports the core client, so a calendar screen imports everything it needs from here.
 */
import { seg } from "@/lib/api";

export * from "@/lib/api";

/** `/api/households/<householdId>/calendar<rest>`; `rest` starts with `/` (its ids already through `seg`). */
export function calendarBase(householdId: string, rest = ""): string {
  return `/api/households/${seg(householdId)}/calendar${rest}`;
}

/** Every calendar request as an Effect (plan e6 P8): filled by M8-T13. Members are arrow functions. */
export const CalendarApi = {};
