/**
 * The calendar wire contract (plan m8 section 5.1, P4, P6, P13, P15, P22). The calendar schemas never had a Zod
 * form, so they are not in the golden corpus: `schema-golden-coverage.test.ts` requires every calendar `*Schema`
 * to have an ok and a not-ok case HERE (the `CASES` table), decoded with `ALL_ISSUES`, and the keyed rules are
 * checked through `toValidationIssues` (the `details` a route sends).
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import * as shared from "../src/index.ts";
import {
  ALL_ISSUES,
  CalendarAssigneeModeSchema,
  CalendarCarConflictSchema,
  CalendarDateSchema,
  CalendarEntryKindSchema,
  CalendarEntryListQuerySchema,
  CalendarEntryListResponseSchema,
  CalendarEntrySchema,
  CalendarMemberSchema,
  CalendarOccurrenceListResponseSchema,
  CalendarOccurrenceQuerySchema,
  CalendarOccurrenceSchema,
  CalendarOccurrenceStatusSchema,
  CalendarRepeatFreqSchema,
  CalendarRepeatSchema,
  CalendarResourceListQuerySchema,
  CalendarResourceListResponseSchema,
  CalendarResourceSchema,
  CalendarTimeSchema,
  CalendarWasteCategorySchema,
  CalendarWasteDetailSchema,
  CalendarWasteImportResponseSchema,
  CalendarWasteImportSchema,
  CalendarWasteOverviewQuerySchema,
  CalendarWasteOverviewResponseSchema,
  CalendarWastePickupSchema,
  CalendarWastePreviewSchema,
  CalendarWasteProviderSchema,
  CalendarWasteSettingsSchema,
  CalendarWasteSourceRequestSchema,
  CalendarWasteUploadFieldsSchema,
  CalendarWeekdaySchema,
  CreateCalendarEntryRequestSchema,
  CreateCalendarResourceRequestSchema,
  ERROR_CODES,
  PutCalendarWasteSettingsRequestSchema,
  SetCalendarOccurrenceStatusRequestSchema,
  UpdateCalendarEntryRequestSchema,
  UpdateCalendarResourceRequestSchema,
  toValidationIssues,
} from "../src/index.ts";
import { parse, safeParse, type Decodable } from "./support/schema.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const ISO = "2027-01-04T10:00:00.000Z";

const repeatNone = { freq: "none", interval: 1, weekdays: [], until: null };

const entry = {
  id: A,
  householdId: B,
  kind: "event",
  title: "Elternabend",
  notes: null,
  location: null,
  allDay: false,
  startDate: "2027-01-05",
  startTime: "19:30",
  endDate: "2027-01-05",
  endTime: null,
  repeat: repeatNone,
  attendeeIds: [],
  assigneeMode: "none",
  assigneeIds: [],
  resourceId: null,
  category: null,
  categoryDetail: null,
  wasteImportId: null,
  createdBy: C,
  createdAt: ISO,
  updatedAt: ISO,
};

const occurrence = {
  id: `${A}:2027-01-05`,
  entryId: A,
  kind: "task",
  title: null,
  category: "waste_bio",
  categoryDetail: "bio_cleaning",
  date: "2027-01-05",
  endDate: "2027-01-05",
  allDay: true,
  startTime: null,
  endTime: null,
  location: null,
  recurring: false,
  memberIds: [],
  assigneeId: B,
  resourceId: null,
  status: "done",
  doneBy: B,
};

const member = { userId: A, name: "Robin", colorIndex: 2, hasAccount: true };
const resource = { id: A, kind: "car", name: "Familienauto", archived: false, archivedAt: null, createdAt: ISO };
const settings = { provider: "hattingen", tour: 4, sourceUrl: null, assigneeMode: "rotate", assigneeIds: [A, B], updatedAt: ISO };
const wasteImport = {
  id: A,
  provider: "hattingen",
  year: 2027,
  tour: 4,
  source: "upload",
  sourceName: "AbfallFlyer 2027.pdf",
  entryCount: 80,
  importedAt: ISO,
  importedBy: null,
};
const pickup = { category: "waste_rest", date: "2027-01-08", detail: null };
const counts = { waste_rest: 26, waste_yellow: 26, waste_bio: 40, waste_paper: 13, waste_tree: 1 };

/** Every calendar schema: inputs that decode and inputs that are refused (P22 reads the names from this table). */
const CASES: Record<string, { readonly schema: Decodable; readonly ok: ReadonlyArray<unknown>; readonly bad: ReadonlyArray<unknown> }> = {
  CalendarDateSchema: { schema: CalendarDateSchema, ok: ["2027-01-01", "2028-02-29"], bad: ["2027-02-29", "2027-1-1", "1899-12-31", 20270101] },
  CalendarTimeSchema: { schema: CalendarTimeSchema, ok: ["00:00", "23:59"], bad: ["24:00", "7:30", null] },
  CalendarEntryKindSchema: { schema: CalendarEntryKindSchema, ok: ["event", "task", "car"], bad: ["chore", ""] },
  CalendarRepeatFreqSchema: { schema: CalendarRepeatFreqSchema, ok: ["none", "yearly"], bad: ["hourly"] },
  CalendarWeekdaySchema: { schema: CalendarWeekdaySchema, ok: ["MO", "SU"], bad: ["Mo", "MON"] },
  CalendarAssigneeModeSchema: { schema: CalendarAssigneeModeSchema, ok: ["none", "fixed", "rotate"], bad: ["all"] },
  CalendarOccurrenceStatusSchema: { schema: CalendarOccurrenceStatusSchema, ok: ["open", "done", "skipped"], bad: [null] },
  CalendarWasteCategorySchema: { schema: CalendarWasteCategorySchema, ok: ["waste_rest", "waste_tree"], bad: ["rest"] },
  CalendarWasteDetailSchema: { schema: CalendarWasteDetailSchema, ok: ["bio_cleaning"], bad: ["cleaning"] },
  CalendarWasteProviderSchema: { schema: CalendarWasteProviderSchema, ok: ["hattingen"], bad: ["bochum"] },
  CalendarMemberSchema: { schema: CalendarMemberSchema, ok: [member], bad: [{ ...member, colorIndex: 7 }, { ...member, hasAccount: "yes" }] },
  CalendarRepeatSchema: {
    schema: CalendarRepeatSchema,
    ok: [repeatNone, { freq: "weekly" }, { freq: "weekly", interval: 2, weekdays: ["MO", "TH"], until: "2027-12-31" }],
    bad: [{ freq: "weekly", interval: 0 }, { freq: "daily", interval: 100 }, { freq: "weekly", weekdays: ["XX"] }],
  },
  CreateCalendarEntryRequestSchema: {
    schema: CreateCalendarEntryRequestSchema,
    ok: [
      { kind: "event", title: "Zahnarzt", allDay: false, startDate: "2027-01-05", startTime: "08:00" },
      { kind: "event", title: "Zahnarzt", allDay: true, startDate: "2027-01-05", today: "2026-11-06" },
    ],
    bad: [
      { kind: "event", title: "", allDay: true, startDate: "2027-01-05" },
      { kind: "event", title: "x", allDay: false, startDate: "2027-01-05" },
      { kind: "event", title: "x", allDay: true, startDate: "2027-01-05", today: "2026-11-31" },
    ],
  },
  UpdateCalendarEntryRequestSchema: {
    schema: UpdateCalendarEntryRequestSchema,
    ok: [{}, { notes: null }, { title: "Neu", allowConflict: true }, { startTime: "07:00", today: "2026-11-06" }],
    bad: [{ title: "" }, { startDate: "2027-02-30" }, { today: "06.11.2026" }],
  },
  CalendarEntrySchema: { schema: CalendarEntrySchema, ok: [entry], bad: [{ ...entry, title: undefined }, { ...entry, kind: "chore" }] },
  CalendarEntryListQuerySchema: {
    schema: CalendarEntryListQuerySchema,
    ok: [{}, { kind: "task", recurring: "true" }],
    bad: [{ recurring: "yes" }, { kind: "chore" }],
  },
  CalendarEntryListResponseSchema: { schema: CalendarEntryListResponseSchema, ok: [{ items: [] }, { items: [entry] }], bad: [{}, { items: [{}] }] },
  CalendarCarConflictSchema: {
    schema: CalendarCarConflictSchema,
    ok: [{ entryId: A, date: "2027-01-07", startTime: "08:00", endTime: "17:00", title: "Arbeit", memberIds: [B] }],
    bad: [{ entryId: A, date: "2027-01-07", startTime: "08:00", endTime: "17:00", title: "Arbeit" }],
  },
  CalendarOccurrenceQuerySchema: {
    schema: CalendarOccurrenceQuerySchema,
    ok: [{ from: "2027-01-01", to: "2027-01-01" }, { from: "2027-01-01", to: "2028-12-31", memberId: A, kind: "car" }],
    bad: [{ from: "2027-01-02", to: "2027-01-01" }, { from: "2027-01-01" }, { from: "2027-01-01", to: "2027-01-31", memberId: "me" }],
  },
  CalendarOccurrenceSchema: { schema: CalendarOccurrenceSchema, ok: [occurrence], bad: [{ ...occurrence, status: "late" }, { ...occurrence, doneBy: undefined }] },
  CalendarOccurrenceListResponseSchema: {
    schema: CalendarOccurrenceListResponseSchema,
    ok: [{ items: [occurrence], members: [member] }],
    bad: [{ items: [occurrence] }],
  },
  SetCalendarOccurrenceStatusRequestSchema: {
    schema: SetCalendarOccurrenceStatusRequestSchema,
    ok: [{ status: "done" }, { status: "skipped" }, { status: null }],
    bad: [{ status: "open" }, {}],
  },
  CalendarResourceSchema: { schema: CalendarResourceSchema, ok: [resource, { ...resource, archived: true, archivedAt: ISO }], bad: [{ ...resource, kind: "bike" }] },
  CalendarResourceListQuerySchema: {
    schema: CalendarResourceListQuerySchema,
    ok: [{}, { includeArchived: "true" }, { includeArchived: "false" }],
    bad: [{ includeArchived: "1" }, { includeArchived: true }],
  },
  CalendarResourceListResponseSchema: { schema: CalendarResourceListResponseSchema, ok: [{ items: [resource] }], bad: [{ items: null }] },
  CreateCalendarResourceRequestSchema: {
    schema: CreateCalendarResourceRequestSchema,
    ok: [{ name: "VW Golf" }, { name: "  Familienauto  " }],
    bad: [{ name: "   " }, { name: "x".repeat(61) }, { name: "Auto\nzwei" }, {}],
  },
  UpdateCalendarResourceRequestSchema: {
    schema: UpdateCalendarResourceRequestSchema,
    ok: [{}, { archived: true }, { name: "Neu" }],
    bad: [{ archived: "yes" }, { name: "" }],
  },
  CalendarWasteSettingsSchema: { schema: CalendarWasteSettingsSchema, ok: [settings], bad: [{ ...settings, tour: 10 }, { ...settings, sourceUrl: undefined }] },
  PutCalendarWasteSettingsRequestSchema: {
    schema: PutCalendarWasteSettingsRequestSchema,
    ok: [
      { provider: "hattingen", tour: 4, assigneeMode: "none", assigneeIds: [], today: "2027-01-01" },
      { provider: "hattingen", tour: 9, assigneeMode: "rotate", assigneeIds: [A, B, C], today: "2027-01-01" },
    ],
    bad: [
      { provider: "hattingen", tour: 0, assigneeMode: "none", assigneeIds: [], today: "2027-01-01" },
      { provider: "hattingen", tour: 4, assigneeMode: "fixed", assigneeIds: [], today: "2027-01-01" },
      { provider: "hattingen", tour: 4, assigneeMode: "none", assigneeIds: [] },
    ],
  },
  CalendarWasteImportSchema: { schema: CalendarWasteImportSchema, ok: [wasteImport], bad: [{ ...wasteImport, source: "mail" }] },
  CalendarWastePickupSchema: {
    schema: CalendarWastePickupSchema,
    ok: [pickup, { category: "waste_bio", date: "2027-03-19", detail: "bio_cleaning" }],
    bad: [{ category: "waste_rest", date: "2027-01-08" }],
  },
  CalendarWasteOverviewQuerySchema: { schema: CalendarWasteOverviewQuerySchema, ok: [{ from: "2027-01-01" }], bad: [{}, { from: "today" }] },
  CalendarWasteOverviewResponseSchema: {
    schema: CalendarWasteOverviewResponseSchema,
    ok: [{ settings: null, imports: [], next: [] }, { settings, imports: [wasteImport], next: [pickup] }],
    bad: [{ imports: [], next: [] }],
  },
  CalendarWasteSourceRequestSchema: {
    schema: CalendarWasteSourceRequestSchema,
    ok: [{ tour: 4, url: "https://www.hattingen.de/x.pdf" }, { provider: "hattingen", tour: 1, url: "http://example.org/a.pdf" }],
    bad: [{ tour: 4, url: "not a url" }, { tour: 4 }, { tour: "4", url: "https://www.hattingen.de/x.pdf" }],
  },
  CalendarWasteUploadFieldsSchema: { schema: CalendarWasteUploadFieldsSchema, ok: [{ tour: "4" }, { tour: 9 }], bad: [{ tour: "10" }, { tour: "vier" }, {}] },
  CalendarWastePreviewSchema: {
    schema: CalendarWastePreviewSchema,
    ok: [{ provider: "hattingen", year: 2027, tour: 4, counts, dates: [pickup], warnings: [] }],
    bad: [{ provider: "hattingen", year: 2027, tour: 4, counts: { waste_rest: 1 }, dates: [], warnings: [] }],
  },
  CalendarWasteImportResponseSchema: {
    schema: CalendarWasteImportResponseSchema,
    ok: [{ import: wasteImport, entryCount: 80 }],
    bad: [{ import: wasteImport, entryCount: -1 }],
  },
};

describe("every calendar schema decodes its ok inputs and refuses its bad ones", () => {
  for (const [name, { schema, ok, bad }] of Object.entries(CASES)) {
    test(name, () => {
      expect(ok.length).toBeGreaterThan(0);
      expect(bad.length).toBeGreaterThan(0);
      for (const input of ok) expect(safeParse(schema, input).success, `${name} ok ${JSON.stringify(input)}`).toBe(true);
      for (const input of bad) expect(safeParse(schema, input).success, `${name} bad ${JSON.stringify(input)}`).toBe(false);
    });
  }

  test("the table covers every calendar *Schema the package exports, and nothing else", () => {
    const calendarNames = Object.keys(shared).filter(
      (name) => name.endsWith("Schema") && (name.includes("Calendar") || name.includes("Waste")),
    );
    expect(Object.keys(CASES).sort()).toEqual(calendarNames.sort());
  });

  test("a response decodes to itself (decoding is the identity on the wire)", () => {
    for (const value of [entry, occurrence, resource, settings, wasteImport]) {
      const schema = [CalendarEntrySchema, CalendarOccurrenceSchema, CalendarResourceSchema, CalendarWasteSettingsSchema, CalendarWasteImportSchema][
        [entry, occurrence, resource, settings, wasteImport].indexOf(value)
      ]!;
      expect(parse(schema, value)).toEqual(value as never);
    }
  });
});

/** The `details` a route would send for `input`: `[path, i18n key]` pairs. */
function details(schema: Decodable, input: unknown): Array<[string, string]> {
  const result = Schema.decodeUnknownExit(schema, ALL_ISSUES)(input);
  if (result._tag === "Success") return [];
  const failure = result.cause.reasons.find((reason) => reason._tag === "Fail");
  const error = failure?._tag === "Fail" ? (failure.error as Schema.SchemaError) : undefined;
  if (error === undefined) throw new Error("expected a SchemaError");
  return toValidationIssues(error.issue, "de").map((item) => [item.path, item.i18n.key]);
}

const event = { kind: "event", title: "Termin", allDay: true, startDate: "2027-01-05" } as const;
const task = { kind: "task", title: "Blumen gießen", allDay: true, startDate: "2027-01-05" } as const;
const car = {
  kind: "car",
  title: "Arbeit",
  allDay: false,
  startDate: "2027-01-07",
  startTime: "08:00",
  endTime: "17:00",
  attendeeIds: [A],
  resourceId: B,
} as const;

describe("P6: entry validation by kind (create schema struct check)", () => {
  const ok = (input: unknown) => expect(details(CreateCalendarEntryRequestSchema, input)).toEqual([]);
  const refused = (input: unknown, expected: Array<[string, string]>) =>
    expect(details(CreateCalendarEntryRequestSchema, input)).toEqual(expected);

  test("event: all-day without times, timed with an optional end, attendees 0-20, no assignees, no resource", () => {
    ok(event);
    ok({ ...event, attendeeIds: [A, B] });
    ok({ ...event, allDay: false, startTime: "19:30" });
    ok({ ...event, allDay: false, startTime: "19:30", endTime: "21:00" });
    ok({ ...event, endDate: "2027-01-09" });
    refused({ ...event, startTime: "08:00" }, [["startTime", "server.calendar.allDayNoTime"]]);
    refused({ ...event, allDay: false }, [["startTime", "server.calendar.timeRequired"]]);
    refused({ ...event, allDay: false, startTime: "19:30", endTime: "19:30" }, [["endTime", "server.calendar.endBeforeStart"]]);
    refused({ ...event, endDate: "2027-01-04" }, [["endDate", "server.calendar.endBeforeStart"]]);
    refused({ ...event, assigneeMode: "fixed", assigneeIds: [A] }, [
      ["assigneeMode", "server.calendar.assigneesOnlyTasks"],
      ["assigneeIds", "server.calendar.assigneesOnlyTasks"],
    ]);
    refused({ ...event, resourceId: A }, [["resourceId", "server.calendar.resourceOnlyCars"]]);
    refused({ ...event, attendeeIds: [A, A] }, [["attendeeIds", "server.calendar.duplicateIds"]]);
  });

  test("event: more than 20 attendees is too_big", () => {
    const many = Array.from({ length: 21 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect(details(CreateCalendarEntryRequestSchema, { ...event, attendeeIds: many })).toEqual([["attendeeIds", "server.zod.too_big.array"]]);
  });

  test("a timed multi-day event may end earlier in the day than it started", () => {
    ok({ ...event, allDay: false, startTime: "20:00", endDate: "2027-01-06", endTime: "08:00" });
  });

  test("task: single day, no attendees, assignee none/fixed/rotate", () => {
    ok(task);
    ok({ ...task, assigneeMode: "fixed", assigneeIds: [A] });
    ok({ ...task, assigneeMode: "rotate", assigneeIds: [A, B, C] });
    ok({ ...task, allDay: false, startTime: "18:00" });
    refused({ ...task, endDate: "2027-01-06" }, [["endDate", "server.calendar.taskSingleDay"]]);
    refused({ ...task, attendeeIds: [A] }, [["attendeeIds", "server.calendar.attendeesNotOnTasks"]]);
    refused({ ...task, assigneeIds: [A] }, [["assigneeIds", "server.calendar.assigneesForNone"]]);
    refused({ ...task, assigneeMode: "fixed", assigneeIds: [A, B] }, [["assigneeIds", "server.calendar.fixedNeedsOne"]]);
    refused({ ...task, assigneeMode: "fixed" }, [["assigneeIds", "server.calendar.fixedNeedsOne"]]);
    refused({ ...task, assigneeMode: "rotate", assigneeIds: [A] }, [["assigneeIds", "server.calendar.rotateNeedsTwo"]]);
    refused({ ...task, assigneeMode: "rotate", assigneeIds: [A, A] }, [["assigneeIds", "server.calendar.duplicateIds"]]);
    refused({ ...task, resourceId: A }, [["resourceId", "server.calendar.resourceOnlyCars"]]);
  });

  test("task: a rotation of more than 12 is too_big", () => {
    const many = Array.from({ length: 13 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect(details(CreateCalendarEntryRequestSchema, { ...task, assigneeMode: "rotate", assigneeIds: many })).toEqual([
      ["assigneeIds", "server.zod.too_big.array"],
    ]);
  });

  test("car: all-day, or timed with start AND end; exactly one person; a resource; no assignees", () => {
    ok(car);
    ok({ ...car, allDay: true, startTime: null, endTime: null });
    ok({ ...car, endDate: "2027-01-09", endTime: "07:00" });
    refused({ ...car, endTime: null }, [["endTime", "server.calendar.timeRequired"]]);
    refused({ ...car, attendeeIds: [] }, [["attendeeIds", "server.calendar.carNeedsOnePerson"]]);
    refused({ ...car, attendeeIds: [A, B] }, [["attendeeIds", "server.calendar.carNeedsOnePerson"]]);
    refused({ ...car, resourceId: null }, [["resourceId", "server.calendar.carNeedsResource"]]);
    refused({ ...car, assigneeMode: "rotate", assigneeIds: [A, B] }, [
      ["assigneeMode", "server.calendar.assigneesOnlyTasks"],
      ["assigneeIds", "server.calendar.assigneesOnlyTasks"],
    ]);
    refused({ ...car, endTime: "07:00" }, [["endTime", "server.calendar.endBeforeStart"]]);
  });

  test("repeat: until not before the start, weekdays only for weekly", () => {
    ok({ ...task, repeat: { freq: "daily", interval: 3 } });
    ok({ ...task, repeat: { freq: "weekly", weekdays: ["MO", "TH"], until: "2027-01-05" } });
    refused({ ...task, repeat: { freq: "daily", until: "2027-01-04" } }, [["repeat.until", "server.calendar.untilBeforeStart"]]);
    refused({ ...task, repeat: { freq: "monthly", weekdays: ["MO"] } }, [["repeat.weekdays", "server.calendar.weekdaysOnlyWeekly"]]);
  });

  test("repeat defaults fill a sparse rhythm", () => {
    expect(parse(CreateCalendarEntryRequestSchema, { ...task, repeat: { freq: "weekly" } }).repeat).toEqual({
      freq: "weekly",
      interval: 1,
      weekdays: [],
      until: null,
    });
  });

  test("every broken rule is reported at once", () => {
    refused({ ...car, allDay: true, attendeeIds: [], resourceId: null, repeat: { freq: "daily", until: "2027-01-01" } }, [
      ["startTime", "server.calendar.allDayNoTime"],
      ["endTime", "server.calendar.allDayNoTime"],
      ["repeat.until", "server.calendar.untilBeforeStart"],
      ["attendeeIds", "server.calendar.carNeedsOnePerson"],
      ["resourceId", "server.calendar.carNeedsResource"],
    ]);
  });

  test("the struct check waits for the fields (ADR 0013): a bad field reports only itself", () => {
    expect(details(CreateCalendarEntryRequestSchema, { ...event, startDate: "2027-02-30", startTime: "08:00" })).toEqual([
      ["startDate", "server.calendar.invalidDate"],
    ]);
  });

  test("title, location and notes are trimmed and bounded", () => {
    expect(parse(CreateCalendarEntryRequestSchema, { ...event, title: "  Termin  ", location: " Schule " })).toMatchObject({
      title: "Termin",
      location: "Schule",
    });
    expect(details(CreateCalendarEntryRequestSchema, { ...event, title: "   " })).toEqual([["title", "server.zod.field.title.too_small.1"]]);
    expect(safeParse(CreateCalendarEntryRequestSchema, { ...event, title: "x".repeat(201) }).success).toBe(false);
    expect(safeParse(CreateCalendarEntryRequestSchema, { ...event, location: "x".repeat(201) }).success).toBe(false);
    expect(safeParse(CreateCalendarEntryRequestSchema, { ...event, notes: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("queries and the waste settings", () => {
  test("occurrence range: `to` before `from` is rangeOrder at path to (the 400-day cap is the service's)", () => {
    expect(details(CalendarOccurrenceQuerySchema, { from: "2027-01-02", to: "2027-01-01" })).toEqual([["to", "server.calendar.rangeOrder"]]);
    expect(details(CalendarOccurrenceQuerySchema, { from: "2027-01-01", to: "2029-01-01" })).toEqual([]);
  });

  test("waste settings: the assignee rule", () => {
    const base = { provider: "hattingen", tour: 4, today: "2027-01-01" };
    expect(details(PutCalendarWasteSettingsRequestSchema, { ...base, assigneeMode: "none", assigneeIds: [A] })).toEqual([
      ["assigneeIds", "server.calendar.assigneesForNone"],
    ]);
    expect(details(PutCalendarWasteSettingsRequestSchema, { ...base, assigneeMode: "rotate", assigneeIds: [A] })).toEqual([
      ["assigneeIds", "server.calendar.rotateNeedsTwo"],
    ]);
    expect(details(PutCalendarWasteSettingsRequestSchema, { ...base, assigneeMode: "rotate", assigneeIds: [A, A] })).toEqual([
      ["assigneeIds", "server.calendar.duplicateIds"],
    ]);
  });

  test("the upload's tour arrives as a string and decodes to a number", () => {
    expect(parse(CalendarWasteUploadFieldsSchema, { tour: "4" })).toEqual({ tour: 4 });
  });
});

describe("error codes", () => {
  test("the eight calendar codes are in ERROR_CODES", () => {
    for (const code of [
      "calendar_car_conflict",
      "calendar_resource_in_use",
      "calendar_entry_imported",
      "calendar_not_a_task",
      "calendar_range_too_large",
      "calendar_waste_source_refused",
      "calendar_waste_fetch_failed",
      "calendar_waste_unparseable",
    ]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});
