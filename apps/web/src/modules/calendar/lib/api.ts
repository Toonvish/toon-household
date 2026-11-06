/**
 * The calendar module's API (docs/modules/calendar.md §2, plan m8 section 5.2, 5.4). This file adds no transport
 * of its own (SPEC §2): every request is a member of {@link CalendarApi}, built on the helpers of `@/lib/api`
 * (`getJson`, `sendJson`, `sendForm`, `sendVoid`), run on the web's one runtime, and decoded with the shared
 * `Calendar…Schema` (docs/EFFECT.md E11). The exported functions are `Promise` facades over `runPromise`.
 *
 * A READ whose answer fails the decode is `invalid_response`; a WRITE never fails on its 2xx answer (plan e6 P7a).
 * No file of the module imports `effect` (idioms rule (13)): the members only compose the core helpers.
 *
 * `export *` re-exports the core client, so a calendar screen imports everything it needs from here.
 */
import {
  CalendarEntryListResponseSchema,
  CalendarEntrySchema,
  CalendarOccurrenceListResponseSchema,
  CalendarOccurrenceSchema,
  CalendarResourceListResponseSchema,
  CalendarResourceSchema,
  CalendarWasteImportResponseSchema,
  CalendarWasteOverviewResponseSchema,
  CalendarWastePreviewSchema,
  CalendarWasteSettingsSchema,
  type CalendarEntry,
  type CalendarEntryListQuery,
  type CalendarEntryListResponse,
  type CalendarOccurrence,
  type CalendarOccurrenceListResponse,
  type CalendarOccurrenceQuery,
  type CalendarResource,
  type CalendarResourceListResponse,
  type CalendarWasteImportResponse,
  type CalendarWasteOverviewResponse,
  type CalendarWastePreview,
  type CalendarWasteSettings,
  type CalendarWasteSourceRequest,
  type CreateCalendarEntryRequest,
  type CreateCalendarResourceRequest,
  type PutCalendarWasteSettingsRequest,
  type SetCalendarOccurrenceStatusRequest,
  type UpdateCalendarEntryRequest,
  type UpdateCalendarResourceRequest,
} from "@toon/shared";
import { getJson, queryString, seg, sendForm, sendJson, sendVoid, type RequestOptions } from "@/lib/api";
import { runPromise } from "@/lib/runtime";

export * from "@/lib/api";

/** `/api/households/<householdId>/calendar<rest>`; `rest` starts with `/` (its ids already through `seg`). */
export function calendarBase(householdId: string, rest = ""): string {
  return `/api/households/${seg(householdId)}/calendar${rest}`;
}

/**
 * `calendarBase` from path SEGMENTS (`calendarPath(h, "entries", seg(id))`): API sub-paths never appear as a
 * literal starting with `/`, so the module's LINKS grep (every in-module route literal starts with `/calendar`)
 * finds navigation targets only.
 */
function calendarPath(householdId: string, ...segments: string[]): string {
  return calendarBase(householdId, `/${segments.join("/")}`);
}

/** The occurrence filters the screens send (the dates are separate arguments). */
export type CalendarOccurrenceFilters = Partial<Pick<CalendarOccurrenceQuery, "memberId" | "kind">>;

/**
 * Every calendar request as an Effect (plan e6 P8): the member name is the facade's name, the parameters are the
 * facade's without the signal. Members are arrow functions: nothing is read at definition (P16).
 */
export const CalendarApi = {
  /* occurrences */

  fetchOccurrences: (
    householdId: string,
    from: string,
    to: string,
    filters: CalendarOccurrenceFilters = {},
    options?: RequestOptions,
  ) =>
    getJson(
      CalendarOccurrenceListResponseSchema,
      calendarPath(householdId, `occurrences${queryString({ from, to, memberId: filters.memberId, kind: filters.kind })}`),
      options,
    ),

  setOccurrenceStatus: (
    householdId: string,
    entryId: string,
    date: string,
    body: SetCalendarOccurrenceStatusRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PUT",
      CalendarOccurrenceSchema,
      calendarPath(householdId, "entries", seg(entryId), "occurrences", seg(date)),
      body,
      options,
    ),

  /* entries */

  fetchEntries: (householdId: string, query: Partial<CalendarEntryListQuery> = {}, options?: RequestOptions) =>
    getJson(
      CalendarEntryListResponseSchema,
      calendarPath(householdId, `entries${queryString({ kind: query.kind, recurring: query.recurring })}`),
      options,
    ),

  fetchEntry: (householdId: string, entryId: string, options?: RequestOptions) =>
    getJson(CalendarEntrySchema, calendarPath(householdId, "entries", seg(entryId)), options),

  createEntry: (householdId: string, body: CreateCalendarEntryRequest, options?: RequestOptions) =>
    sendJson("POST", CalendarEntrySchema, calendarPath(householdId, "entries"), body, options),

  updateEntry: (householdId: string, entryId: string, body: UpdateCalendarEntryRequest, options?: RequestOptions) =>
    sendJson("PATCH", CalendarEntrySchema, calendarPath(householdId, "entries", seg(entryId)), body, options),

  deleteEntry: (householdId: string, entryId: string, options?: RequestOptions) =>
    sendVoid("DELETE", calendarPath(householdId, "entries", seg(entryId)), undefined, options),

  /* resources (cars) */

  fetchResources: (householdId: string, includeArchived = false, options?: RequestOptions) =>
    getJson(
      CalendarResourceListResponseSchema,
      calendarPath(householdId, `resources${queryString({ includeArchived: includeArchived ? "true" : undefined })}`),
      options,
    ),

  createResource: (householdId: string, body: CreateCalendarResourceRequest, options?: RequestOptions) =>
    sendJson("POST", CalendarResourceSchema, calendarPath(householdId, "resources"), body, options),

  updateResource: (
    householdId: string,
    resourceId: string,
    body: UpdateCalendarResourceRequest,
    options?: RequestOptions,
  ) => sendJson("PATCH", CalendarResourceSchema, calendarPath(householdId, "resources", seg(resourceId)), body, options),

  deleteResource: (householdId: string, resourceId: string, options?: RequestOptions) =>
    sendVoid("DELETE", calendarPath(householdId, "resources", seg(resourceId)), undefined, options),

  /* waste */

  fetchWaste: (householdId: string, from: string, options?: RequestOptions) =>
    getJson(CalendarWasteOverviewResponseSchema, calendarPath(householdId, `waste${queryString({ from })}`), options),

  putWasteSettings: (householdId: string, body: PutCalendarWasteSettingsRequest, options?: RequestOptions) =>
    sendJson("PUT", CalendarWasteSettingsSchema, calendarPath(householdId, "waste", "settings"), body, options),

  previewWasteFromUrl: (householdId: string, body: CalendarWasteSourceRequest, options?: RequestOptions) =>
    sendJson("POST", CalendarWastePreviewSchema, calendarPath(householdId, "waste", "preview"), body, options),

  previewWasteFromFile: (householdId: string, file: File, tour: number, options?: RequestOptions) =>
    sendForm(CalendarWastePreviewSchema, calendarPath(householdId, "waste", "preview"), file, options, { tour: String(tour) }),

  importWasteFromUrl: (householdId: string, body: CalendarWasteSourceRequest, options?: RequestOptions) =>
    sendJson("POST", CalendarWasteImportResponseSchema, calendarPath(householdId, "waste", "import"), body, options),

  importWasteFromFile: (householdId: string, file: File, tour: number, options?: RequestOptions) =>
    sendForm(CalendarWasteImportResponseSchema, calendarPath(householdId, "waste", "import"), file, options, {
      tour: String(tour),
    }),

  deleteWasteImport: (householdId: string, importId: string, options?: RequestOptions) =>
    sendVoid("DELETE", calendarPath(householdId, "waste", "imports", seg(importId)), undefined, options),
};

/* -------------------------------------------------------------------------- */
/* Promise facades                                                            */
/* -------------------------------------------------------------------------- */

export function fetchOccurrences(
  householdId: string,
  from: string,
  to: string,
  filters: CalendarOccurrenceFilters = {},
  options?: RequestOptions,
): Promise<CalendarOccurrenceListResponse> {
  return runPromise(CalendarApi.fetchOccurrences(householdId, from, to, filters, options), options);
}

export function setOccurrenceStatus(
  householdId: string,
  entryId: string,
  date: string,
  body: SetCalendarOccurrenceStatusRequest,
  options?: RequestOptions,
): Promise<CalendarOccurrence> {
  return runPromise(CalendarApi.setOccurrenceStatus(householdId, entryId, date, body, options), options);
}

export function fetchEntries(
  householdId: string,
  query: Partial<CalendarEntryListQuery> = {},
  options?: RequestOptions,
): Promise<CalendarEntryListResponse> {
  return runPromise(CalendarApi.fetchEntries(householdId, query, options), options);
}

export function fetchEntry(householdId: string, entryId: string, options?: RequestOptions): Promise<CalendarEntry> {
  return runPromise(CalendarApi.fetchEntry(householdId, entryId, options), options);
}

export function createEntry(
  householdId: string,
  body: CreateCalendarEntryRequest,
  options?: RequestOptions,
): Promise<CalendarEntry> {
  return runPromise(CalendarApi.createEntry(householdId, body, options), options);
}

export function updateEntry(
  householdId: string,
  entryId: string,
  body: UpdateCalendarEntryRequest,
  options?: RequestOptions,
): Promise<CalendarEntry> {
  return runPromise(CalendarApi.updateEntry(householdId, entryId, body, options), options);
}

export function deleteEntry(householdId: string, entryId: string, options?: RequestOptions): Promise<void> {
  return runPromise(CalendarApi.deleteEntry(householdId, entryId, options), options);
}

export function fetchResources(
  householdId: string,
  includeArchived = false,
  options?: RequestOptions,
): Promise<CalendarResourceListResponse> {
  return runPromise(CalendarApi.fetchResources(householdId, includeArchived, options), options);
}

export function createResource(
  householdId: string,
  body: CreateCalendarResourceRequest,
  options?: RequestOptions,
): Promise<CalendarResource> {
  return runPromise(CalendarApi.createResource(householdId, body, options), options);
}

export function updateResource(
  householdId: string,
  resourceId: string,
  body: UpdateCalendarResourceRequest,
  options?: RequestOptions,
): Promise<CalendarResource> {
  return runPromise(CalendarApi.updateResource(householdId, resourceId, body, options), options);
}

export function deleteResource(householdId: string, resourceId: string, options?: RequestOptions): Promise<void> {
  return runPromise(CalendarApi.deleteResource(householdId, resourceId, options), options);
}

export function fetchWaste(
  householdId: string,
  from: string,
  options?: RequestOptions,
): Promise<CalendarWasteOverviewResponse> {
  return runPromise(CalendarApi.fetchWaste(householdId, from, options), options);
}

export function putWasteSettings(
  householdId: string,
  body: PutCalendarWasteSettingsRequest,
  options?: RequestOptions,
): Promise<CalendarWasteSettings> {
  return runPromise(CalendarApi.putWasteSettings(householdId, body, options), options);
}

export function previewWasteFromUrl(
  householdId: string,
  body: CalendarWasteSourceRequest,
  options?: RequestOptions,
): Promise<CalendarWastePreview> {
  return runPromise(CalendarApi.previewWasteFromUrl(householdId, body, options), options);
}

export function previewWasteFromFile(
  householdId: string,
  file: File,
  tour: number,
  options?: RequestOptions,
): Promise<CalendarWastePreview> {
  return runPromise(CalendarApi.previewWasteFromFile(householdId, file, tour, options), options);
}

export function importWasteFromUrl(
  householdId: string,
  body: CalendarWasteSourceRequest,
  options?: RequestOptions,
): Promise<CalendarWasteImportResponse> {
  return runPromise(CalendarApi.importWasteFromUrl(householdId, body, options), options);
}

export function importWasteFromFile(
  householdId: string,
  file: File,
  tour: number,
  options?: RequestOptions,
): Promise<CalendarWasteImportResponse> {
  return runPromise(CalendarApi.importWasteFromFile(householdId, file, tour, options), options);
}

export function deleteWasteImport(householdId: string, importId: string, options?: RequestOptions): Promise<void> {
  return runPromise(CalendarApi.deleteWasteImport(householdId, importId, options), options);
}
