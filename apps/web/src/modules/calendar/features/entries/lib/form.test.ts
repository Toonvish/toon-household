/** The entry form's mapping to the wire, checked with the shared create schema (plan m8 P6-P8, M8-T16). */
import { describe, expect, test } from "bun:test";
import { CreateCalendarEntryRequestSchema, type CalendarEntry } from "@toon/shared";
import { ApiError } from "@/lib/api";
import { validate } from "@/lib/validation";
import {
  carConflicts,
  draftSeries,
  emptyFormState,
  errorAt,
  formStateFromEntry,
  occurrenceEnd,
  previewFrom,
  toCreateBody,
  toUpdateBody,
  withKind,
  withSaveContext,
} from "./form";

const TODAY = "2026-11-11";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const CAR = "44444444-4444-4444-8444-444444444444";

describe("drafts", () => {
  test("a fresh draft per kind, the date from the URL when it is real", () => {
    expect(emptyFormState("task", "2026-11-20", TODAY)).toMatchObject({ allDay: true, startDate: "2026-11-20" });
    expect(emptyFormState("car", "2026-02-30", TODAY)).toMatchObject({ allDay: false, startTime: "08:00", endTime: "17:00", startDate: TODAY });
    const switched = withKind({ ...emptyFormState("event", undefined, TODAY), title: "X", attendeeIds: [A] }, "task");
    expect(switched).toMatchObject({ kind: "task", title: "X", allDay: true, attendeeIds: [] });
  });
});

describe("toCreateBody passes the shared schema for every kind", () => {
  test("an event for everybody, timed, weekly on Mo and Th", () => {
    const state = { ...emptyFormState("event", TODAY, TODAY), title: " Elternabend ", startTime: "19:30", freq: "weekly" as const, weekdays: ["MO" as const, "TH" as const] };
    const result = validate(CreateCalendarEntryRequestSchema, toCreateBody(state));
    expect(result.ok).toBe(true);
    expect(result.data?.title).toBe("Elternabend");
    expect(result.data?.repeat?.weekdays).toEqual(["MO", "TH"]);
  });

  test("a task rotating over two people, all-day, every 3 days", () => {
    const state = { ...emptyFormState("task", TODAY, TODAY), title: "Blumen gießen", freq: "daily" as const, interval: "3", assigneeMode: "rotate" as const, assigneeIds: [A, B] };
    expect(validate(CreateCalendarEntryRequestSchema, toCreateBody(state)).ok).toBe(true);
  });

  test("a car booking with its car and driver", () => {
    const state = { ...emptyFormState("car", TODAY, TODAY), title: "Einkauf", resourceId: CAR, attendeeIds: [A] };
    const body = toCreateBody(state);
    expect(body).toMatchObject({ kind: "car", resourceId: CAR, attendeeIds: [A], assigneeMode: "none", assigneeIds: [] });
    expect(validate(CreateCalendarEntryRequestSchema, body).ok).toBe(true);
  });

  test("the schema's refusals land on the form's fields", () => {
    const noCar = validate(CreateCalendarEntryRequestSchema, toCreateBody({ ...emptyFormState("car", TODAY, TODAY), title: "X" }));
    expect(noCar.ok).toBe(false);
    expect(errorAt(noCar.errors ?? {}, "resourceId")).toBeDefined();
    expect(errorAt(noCar.errors ?? {}, "attendeeIds")).toBeDefined();
    const noTitle = validate(CreateCalendarEntryRequestSchema, toCreateBody(emptyFormState("event", TODAY, TODAY)));
    expect(errorAt(noTitle.errors ?? {}, "title")).toBeDefined();
    const badInterval = validate(
      CreateCalendarEntryRequestSchema,
      toCreateBody({ ...emptyFormState("task", TODAY, TODAY), title: "X", freq: "daily", interval: "" }),
    );
    expect(errorAt(badInterval.errors ?? {}, "repeat")).toBeDefined();
  });
});

describe("edit", () => {
  const entry: CalendarEntry = {
    id: "e",
    householdId: "h",
    kind: "task",
    title: null,
    notes: null,
    location: null,
    allDay: true,
    startDate: "2027-01-04",
    startTime: null,
    endDate: "2027-01-04",
    endTime: null,
    repeat: { freq: "none", interval: 1, weekdays: [], until: null },
    attendeeIds: [],
    assigneeMode: "fixed",
    assigneeIds: [A],
    resourceId: null,
    category: "waste_rest",
    categoryDetail: null,
    wasteImportId: "i",
    createdBy: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };

  test("an imported waste entry sends only notes and assignees (P8)", () => {
    const state = { ...formStateFromEntry(entry), notes: "Tonne steht hinten" };
    expect(toUpdateBody(state, true)).toEqual({ notes: "Tonne steht hinten", assigneeMode: "fixed", assigneeIds: [A] });
  });

  test("an imported pickup stored with a rotation is edited as its first person (P15)", () => {
    const state = formStateFromEntry({ ...entry, assigneeMode: "rotate", assigneeIds: [B, A] });
    expect(state).toMatchObject({ assigneeMode: "fixed", assigneeIds: [B] });
    expect(toUpdateBody(state, true)).toMatchObject({ assigneeMode: "fixed", assigneeIds: [B] });
    // A regular task keeps its rotation.
    const task = formStateFromEntry({ ...entry, wasteImportId: null, category: null, assigneeMode: "rotate", assigneeIds: [B, A] });
    expect(task).toMatchObject({ assigneeMode: "rotate", assigneeIds: [B, A] });
  });

  test("a regular entry sends every field but kind", () => {
    const body = toUpdateBody({ ...formStateFromEntry({ ...entry, title: "Bad", category: null, wasteImportId: null }) }, false);
    expect("kind" in body).toBe(false);
    expect(body.title).toBe("Bad");
  });

  test("a car booking carries the client's today for its conflict check; other kinds do not (P11)", () => {
    expect(withSaveContext({ title: "Fahrt" }, "car", TODAY, false)).toEqual({ title: "Fahrt", today: TODAY });
    expect(withSaveContext({ title: "Fahrt" }, "car", TODAY, true)).toEqual({ title: "Fahrt", today: TODAY, allowConflict: true });
    expect(withSaveContext({ notes: "x" }, "task", TODAY, false)).toEqual({ notes: "x" });
    const car = { ...emptyFormState("car", TODAY, TODAY), title: "Fahrt", attendeeIds: [A], resourceId: CAR };
    expect(validate(CreateCalendarEntryRequestSchema, withSaveContext(toCreateBody(car), "car", TODAY, false)).ok).toBe(true);
  });

  test("an occurrence keeps the series' length", () => {
    expect(occurrenceEnd({ startDate: "2026-11-13", endDate: "2026-11-15" }, "2026-11-20")).toBe("2026-11-22");
  });
});

describe("the preview and the conflicts", () => {
  test("a draft series only for a valid rhythm; the preview starts today or later", () => {
    const state = { ...emptyFormState("task", "2026-11-20", TODAY), freq: "weekly" as const };
    expect(draftSeries(state)?.repeat.freq).toBe("weekly");
    expect(draftSeries({ ...state, interval: "0" })).toBeNull();
    expect(draftSeries({ ...state, freq: "none" })).toBeNull();
    expect(previewFrom(state, TODAY)).toBe("2026-11-20");
    expect(previewFrom({ ...state, startDate: "2026-01-01" }, TODAY)).toBe(TODAY);
  });

  test("a 409 calendar_car_conflict yields its details, anything else null", () => {
    const details = [{ entryId: "x", date: "2026-11-12", startTime: "08:00", endTime: "17:00", title: null, memberIds: [A] }];
    const conflict = new ApiError({ code: "calendar_car_conflict", status: 409, message: "busy", details });
    expect(carConflicts(conflict)).toEqual(details);
    expect(carConflicts(new ApiError({ code: "not_found", status: 404, message: "x" }))).toBeNull();
    expect(carConflicts(new Error("x"))).toBeNull();
  });
});
