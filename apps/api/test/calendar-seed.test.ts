/**
 * `seedCalendarDemo` (plan m8 M8-T07, P25, design §6) on a scratch database (`Database.layerFrom`), under a pinned
 * `TestClock`: twice, with the same row counts (idempotent by the "Familienauto" marker); every demo item of the design
 * present with dates relative to the Clock's date IN Europe/Berlin (the pinned instant is still the previous day in UTC);
 * the synthetic waste import of tour 4 with its rows; a missing Robin or Kim falls back to the demo user.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { type CreatedDatabase, createDatabase, db as sharedDb } from "../src/db/client.ts";
import { Database } from "../src/db/database.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import {
  calendarEntries,
  calendarEntryMembers,
  calendarResources,
  calendarWasteImports,
  calendarWasteSettings,
} from "../src/modules/calendar/schema.ts";
import { seedCalendarDemo } from "../src/modules/calendar/seed.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { runTest } from "./support/effect.ts";

await runMigrations(sharedDb);

const dir = mkdtempSync(join(tmpdir(), "toon-household-calendar-seed-"));
let created: CreatedDatabase;
const demo = crypto.randomUUID();
const robin = crypto.randomUUID();
const kim = crypto.randomUUID();
const householdId = crypto.randomUUID();
const lonelyHousehold = crypto.randomUUID();
// 2027-01-06 23:30 UTC is 2027-01-07 00:30 in Berlin, a Thursday.
const PINNED = Date.UTC(2027, 0, 6, 23, 30);

function seed(home: string) {
  return runTest(
    Effect.gen(function* () {
      yield* TestClock.setTime(PINNED);
      yield* seedCalendarDemo({ householdId: home, userId: demo, demoPassword: "demo1234" });
    }).pipe(Effect.provide(Database.layerFrom(created))),
    { clock: "test" },
  );
}

async function counts(home: string) {
  const entries = await created.db.select().from(calendarEntries).where(eq(calendarEntries.householdId, home));
  return {
    entries: entries.length,
    resources: (await created.db.select().from(calendarResources).where(eq(calendarResources.householdId, home))).length,
    imports: (await created.db.select().from(calendarWasteImports).where(eq(calendarWasteImports.householdId, home))).length,
    members: (await created.db.select().from(calendarEntryMembers)).filter((row) => entries.some((entry) => entry.id === row.entryId))
      .length,
  };
}

beforeAll(async () => {
  created = createDatabase({ url: `file:${join(dir, "seed.db")}` });
  await created.ready;
  await runMigrations(created.db);
  for (const [id, email, name] of [
    [demo, "demo@toon.local", "Demo"],
    [robin, "robin@toon.local", "Robin"],
    [kim, "kim@toon.local", "Kim"],
  ] as const) {
    await created.db.insert(users).values({ id, email, name, emailVerified: true, emailVerifiedAt: 1 });
  }
  await created.db.insert(households).values([
    { id: householdId, name: "Familie", createdBy: demo },
    { id: lonelyHousehold, name: "Allein", createdBy: demo },
  ]);
  for (const userId of [demo, robin, kim]) {
    await created.db.insert(householdMembers).values({ id: crypto.randomUUID(), householdId, userId, role: "member", createdAt: 1 });
  }
  await created.db
    .insert(householdMembers)
    .values({ id: crypto.randomUUID(), householdId: lonelyHousehold, userId: demo, role: "owner", createdAt: 1 });
});

afterAll(() => {
  created.client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("seedCalendarDemo", () => {
  test("twice: the same rows", async () => {
    await seed(householdId);
    const first = await counts(householdId);
    expect(first).toEqual({ entries: 6 + 21, resources: 1, imports: 1, members: 7 });
    await seed(householdId);
    expect(await counts(householdId)).toEqual(first);
  });

  test("every demo item of design §6, dated from the Berlin date of the Clock", async () => {
    const rows = await created.db
      .select()
      .from(calendarEntries)
      .where(eq(calendarEntries.householdId, householdId))
      .orderBy(asc(calendarEntries.startDate));
    const byTitle = (title: string) => rows.find((row) => row.title === title)!;
    const members = await created.db.select().from(calendarEntryMembers);
    const of = (entryId: string, role: string) =>
      members
        .filter((row) => row.entryId === entryId && row.role === role)
        .sort((a, b) => a.position - b.position)
        .map((row) => row.userId);

    const car = (await created.db.select().from(calendarResources).where(eq(calendarResources.householdId, householdId)))[0]!;
    expect(car.name).toBe("Familienauto");
    expect(car.createdAt).toBe(PINNED);

    const booking = rows.find((row) => row.kind === "car")!;
    expect(booking).toMatchObject({
      resourceId: car.id,
      startDate: "2027-01-07",
      startTime: "08:00",
      endTime: "17:00",
      repeatFreq: "weekly",
      repeatWeekdays: "TH",
      createdAt: PINNED,
    });
    expect(of(booking.id, "attendee")).toEqual([robin]);

    expect(byTitle("Elternabend")).toMatchObject({ kind: "event", startDate: "2027-01-12", startTime: "19:30", repeatFreq: "none" });
    expect(of(byTitle("Elternabend").id, "attendee")).toEqual([]);
    expect(byTitle("Zahnarzt")).toMatchObject({ kind: "event", startDate: "2027-01-09", startTime: "10:30" });
    expect(of(byTitle("Zahnarzt").id, "attendee")).toEqual([robin]);
    expect(byTitle("Kim: Fußballtraining")).toMatchObject({
      startDate: "2027-01-13",
      startTime: "17:00",
      repeatFreq: "weekly",
      repeatWeekdays: "WE",
    });
    expect(of(byTitle("Kim: Fußballtraining").id, "attendee")).toEqual([kim]);
    expect(byTitle("Blumen gießen")).toMatchObject({
      kind: "task",
      startDate: "2027-01-07",
      repeatFreq: "daily",
      repeatInterval: 3,
      assigneeMode: "rotate",
    });
    expect(of(byTitle("Blumen gießen").id, "assignee")).toEqual([demo, robin, kim]);
    expect(byTitle("Bad putzen")).toMatchObject({ startDate: "2027-01-09", repeatWeekdays: "SA", assigneeMode: "fixed" });
    expect(of(byTitle("Bad putzen").id, "assignee")).toEqual([kim]);
  });

  test("the synthetic waste schedule: tour 4, the current and the next 8 weeks", async () => {
    const imports = await created.db.select().from(calendarWasteImports).where(eq(calendarWasteImports.householdId, householdId));
    expect(imports.map((row) => [row.provider, row.year, row.tour, row.source, row.sourceName, row.entryCount])).toEqual([
      ["hattingen", 2027, 4, "upload", "demo-seed", 21],
    ]);
    const settings = await created.db.select().from(calendarWasteSettings).where(eq(calendarWasteSettings.householdId, householdId));
    expect(settings.map((row) => [row.provider, row.tour, row.assigneeMode])).toEqual([["hattingen", 4, "none"]]);
    const waste = (await created.db.select().from(calendarEntries).where(eq(calendarEntries.wasteImportId, imports[0]!.id)))
      .map((row) => `${row.startDate} ${row.category}`)
      .sort();
    const rest = waste.filter((row) => row.endsWith("waste_rest")).map((row) => row.slice(0, 10));
    expect(rest).toEqual(["2027-01-04", "2027-01-18", "2027-02-01", "2027-02-15", "2027-03-01"]);
    expect(waste.filter((row) => row.endsWith("waste_yellow")).map((row) => row.slice(0, 10))).toEqual(rest);
    const bio = waste.filter((row) => row.endsWith("waste_bio")).map((row) => row.slice(0, 10));
    expect(bio.length).toBe(9);
    expect(bio[0]).toBe("2027-01-07");
    expect(waste.filter((row) => row.endsWith("waste_paper")).map((row) => row.slice(0, 10))).toEqual(["2027-01-15", "2027-02-12"]);
    const rows = await created.db.select().from(calendarEntries).where(eq(calendarEntries.wasteImportId, imports[0]!.id));
    for (const row of rows) expect(row).toMatchObject({ kind: "task", title: null, allDay: true, endDate: row.startDate });
  });

  test("without Robin and Kim in the household everything goes to the demo user", async () => {
    await seed(lonelyHousehold);
    const rows = await created.db.select().from(calendarEntries).where(eq(calendarEntries.householdId, lonelyHousehold));
    const flowers = rows.find((row) => row.title === "Blumen gießen")!;
    expect(flowers.assigneeMode).toBe("fixed");
    const members = await created.db.select().from(calendarEntryMembers);
    const named = new Set(members.filter((row) => rows.some((entry) => entry.id === row.entryId)).map((row) => row.userId));
    expect([...named]).toEqual([demo]);
  });
});
