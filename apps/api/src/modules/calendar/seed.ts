/**
 * The calendar module's demo content for `bun run seed` (design §6, plan m8 P25), relative to the seed run's date
 * (the Clock's instant in Europe/Berlin):
 *
 * - a car "Familienauto" with Robin's weekly booking (Thursday 08:00-17:00);
 * - events "Elternabend" (everybody, next Tuesday 19:30), "Zahnarzt" (Robin, in two days 10:30) and
 *   "Kim: Fußballtraining" (Kim, weekly Wednesday 17:00-18:30);
 * - tasks "Blumen gießen" (every 3 days from today, rotating demo user -> Robin -> Kim) and "Bad putzen" (weekly
 *   Saturday, fixed Kim);
 * - a SYNTHETIC waste schedule, never data copied from the flyer: provider `hattingen`, tour 4, `source "upload"`,
 *   `source_name "demo-seed"`, over the current and the next 8 weeks: Restmüll and Gelber Sack fortnightly (Monday),
 *   Biotonne weekly (Thursday), Papier every 4 weeks (Friday); ONE import per calendar year the dates touch (a seed in
 *   December writes this year's and next year's, so a later real import of either year replaces exactly its own
 *   pickups), a year that already has an import skipped; the settings row with no assignee. The rows are written
 *   directly (no PDF, no waste service).
 *
 * Idempotent by its marker, the household's car named "Familienauto" (present = done). People by e-mail among the
 * household's members (`robin@toon.local`, `kim@toon.local`, both created by finance's seed earlier in module order); a
 * missing one falls back to the demo user. Content language is German on purpose (demo data, not interface copy;
 * this file is on the i18n check's allow list). An Effect over the CURRENT `Database` executor only (P14), with
 * direct statements in ONE transaction; the calendar module is not enabled here (the owner enables it on Home).
 */
import {
  type WasteCategory,
  addCalendarDays,
  calendarWeekday,
} from "@toon/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Clock, Console, DateTime, Effect } from "effect";
import { Database } from "../../db/database.ts";
import { householdMembers, users } from "../../db/schema.ts";
import type { SeedDemoContext } from "../types.ts";
import {
  type NewCalendarEntryMemberRow,
  type NewCalendarEntryRow,
  calendarEntries,
  calendarEntryMembers,
  calendarResources,
  calendarWasteImports,
  calendarWasteSettings,
} from "./schema.ts";

const MARKER = "Familienauto";

/** The first date on or after `from` (or after it, with `strictly`) that falls on `weekday` (0 = Monday). */
function nextWeekday(from: string, weekday: number, strictly = false): string {
  const offset = (weekday - calendarWeekday(from) + 7) % 7;
  return addCalendarDays(from, offset === 0 && strictly ? 7 : offset);
}

/** The synthetic pickups (P25): `[category, date]` over the current and the next 8 weeks. */
export function syntheticWastePickups(today: string): Array<[WasteCategory, string]> {
  const monday = addCalendarDays(today, -calendarWeekday(today));
  const pickups: Array<[WasteCategory, string]> = [];
  for (let week = 0; week <= 8; week += 1) {
    const weekMonday = addCalendarDays(monday, week * 7);
    if (week % 2 === 0) {
      pickups.push(["waste_rest", weekMonday], ["waste_yellow", weekMonday]);
    }
    pickups.push(["waste_bio", addCalendarDays(weekMonday, 3)]);
    if (week % 4 === 1) pickups.push(["waste_paper", addCalendarDays(weekMonday, 4)]);
  }
  return pickups;
}

export const seedCalendarDemo = Effect.fn("calendar.seedDemo")(function* (context: SeedDemoContext) {
  const database = yield* Database;
  const { householdId, userId } = context;

  const marker = yield* database.use((db) =>
    db
      .select({ id: calendarResources.id })
      .from(calendarResources)
      .where(and(eq(calendarResources.householdId, householdId), eq(calendarResources.name, MARKER)))
      .limit(1),
  );
  if (marker.length > 0) {
    yield* Console.log("[seed] calendar demo already present");
    return;
  }

  const people = yield* database.use((db) =>
    db
      .select({ id: users.id, email: users.email })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(
        and(eq(householdMembers.householdId, householdId), inArray(users.email, ["robin@toon.local", "kim@toon.local"])),
      ),
  );
  const robin = people.find((person) => person.email === "robin@toon.local")?.id ?? userId;
  const kim = people.find((person) => person.email === "kim@toon.local")?.id ?? userId;

  const now = yield* Clock.currentTimeMillis;
  const today = DateTime.formatIsoDate(DateTime.makeZonedUnsafe(yield* DateTime.now, { timeZone: "Europe/Berlin" }));

  const carId = crypto.randomUUID();
  const entries: Array<NewCalendarEntryRow> = [];
  const members: Array<NewCalendarEntryMemberRow> = [];
  const add = (
    entry: Omit<NewCalendarEntryRow, "id" | "householdId" | "createdAt" | "updatedAt" | "createdBy" | "endDate"> & { endDate?: string },
    attendees: ReadonlyArray<string> = [],
    assignees: ReadonlyArray<string> = [],
  ) => {
    const id = crypto.randomUUID();
    entries.push({ ...entry, id, householdId, endDate: entry.endDate ?? entry.startDate, createdBy: userId, createdAt: now, updatedAt: now });
    attendees.forEach((member, position) => members.push({ entryId: id, userId: member, role: "attendee", position }));
    assignees.forEach((member, position) => members.push({ entryId: id, userId: member, role: "assignee", position }));
    return id;
  };

  add(
    {
      kind: "car",
      title: "Arbeit",
      allDay: false,
      startDate: nextWeekday(today, 3),
      startTime: "08:00",
      endTime: "17:00",
      repeatFreq: "weekly",
      repeatWeekdays: "TH",
      resourceId: carId,
    },
    [robin],
  );
  add({ kind: "event", title: "Elternabend", allDay: false, startDate: nextWeekday(today, 1, true), startTime: "19:30" });
  add({ kind: "event", title: "Zahnarzt", allDay: false, startDate: addCalendarDays(today, 2), startTime: "10:30" }, [robin]);
  add(
    {
      kind: "event",
      title: "Kim: Fußballtraining",
      allDay: false,
      startDate: nextWeekday(today, 2),
      startTime: "17:00",
      endTime: "18:30",
      repeatFreq: "weekly",
      repeatWeekdays: "WE",
    },
    [kim],
  );
  add(
    { kind: "task", title: "Blumen gießen", allDay: true, startDate: today, repeatFreq: "daily", repeatInterval: 3, assigneeMode: "rotate" },
    [],
    [userId, robin, kim].filter((member, index, all) => all.indexOf(member) === index),
  );
  add(
    {
      kind: "task",
      title: "Bad putzen",
      allDay: true,
      startDate: nextWeekday(today, 5),
      repeatFreq: "weekly",
      repeatWeekdays: "SA",
      assigneeMode: "fixed",
    },
    [],
    [kim],
  );
  // A rotation of one person (Robin or Kim missing) is a fixed assignee.
  const flowers = entries.find((entry) => entry.title === "Blumen gießen")!;
  if (members.filter((member) => member.entryId === flowers.id).length < 2) flowers.assigneeMode = "fixed";

  // One synthetic import per year the pickups touch (one import per household, provider and year); a year that already
  // has an import (a real one) keeps it and gets no synthetic pickups.
  const byYear = new Map<number, Array<[WasteCategory, string]>>();
  for (const pickup of syntheticWastePickups(today)) {
    const pickupYear = Number(pickup[1].slice(0, 4));
    byYear.set(pickupYear, [...(byYear.get(pickupYear) ?? []), pickup]);
  }
  const taken = yield* database.use((db) =>
    db
      .select({ year: calendarWasteImports.year })
      .from(calendarWasteImports)
      .where(
        and(
          eq(calendarWasteImports.householdId, householdId),
          eq(calendarWasteImports.provider, "hattingen"),
          inArray(calendarWasteImports.year, [...byYear.keys()]),
        ),
      ),
  );
  for (const row of taken) byYear.delete(row.year);
  const wasteImports = [...byYear].map(([year, pickups]) => ({ id: crypto.randomUUID(), year, pickups }));
  const pickupCount = wasteImports.reduce((sum, item) => sum + item.pickups.length, 0);
  const wasteEntries: Array<NewCalendarEntryRow> = wasteImports.flatMap((item) =>
    item.pickups.map(([category, date]) => ({
      id: crypto.randomUUID(),
      householdId,
      kind: "task",
      title: null,
      allDay: true,
      startDate: date,
      endDate: date,
      category,
      wasteImportId: item.id,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })),
  );

  yield* database.transaction(
    Effect.gen(function* () {
      yield* database.use((db) =>
        db.insert(calendarResources).values({ id: carId, householdId, kind: "car", name: MARKER, archivedAt: null, createdAt: now }),
      );
      yield* database.use((db) => db.insert(calendarEntries).values(entries));
      if (members.length > 0) yield* database.use((db) => db.insert(calendarEntryMembers).values(members));
      yield* database.use((db) =>
        db
          .insert(calendarWasteSettings)
          .values({ householdId, provider: "hattingen", tour: 4, sourceUrl: null, assigneeMode: "none", updatedAt: now })
          .onConflictDoNothing(),
      );
      if (wasteImports.length === 0) return;
      yield* database.use((db) =>
        db.insert(calendarWasteImports).values(
          wasteImports.map((item) => ({
            id: item.id,
            householdId,
            provider: "hattingen",
            year: item.year,
            tour: 4,
            source: "upload",
            sourceName: "demo-seed",
            entryCount: item.pickups.length,
            importedAt: now,
            importedBy: userId,
          })),
        ),
      );
      yield* database.use((db) => db.insert(calendarEntries).values(wasteEntries));
    }),
  );
  yield* Console.log(
    `[seed] calendar: car "${MARKER}", ${entries.length} entries, ${pickupCount} waste pickups (tour 4)`,
  );
});
