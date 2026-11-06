/**
 * `CalendarWaste` (plan m8 P15, P16, P20; M8-T12) over the runtime's database and the REAL extraction of the committed
 * 2027 flyer (uploaded, tour 4). A URL import goes through the seam `setWasteFlyerFetchForTests` (no network).
 *
 * - import writes one all-day task per (type, date) of the tour, with category, detail and the import id;
 * - import twice REPLACES the year's import and carries the done/skipped marks by (category, date);
 * - the assignee is resolved per PICKUP DAY (every type of one day to the same person) at import and by `putSettings`
 *   from the client's `today` on (earlier entries keep theirs);
 * - the overview's `next` skips a skipped pickup; `removeImport` is household-scoped.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WASTE_PROVIDERS } from "@toon/shared";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { calendarEntries, calendarEntryMembers, calendarOccurrenceStates, calendarWasteImports } from "../src/db/schema.ts";
import { makeTestWasteFlyerFetch, setWasteFlyerFetchForTests } from "../src/modules/calendar/services/waste/fetch.ts";
import { CalendarWaste, type WasteSource, assigneeForDay } from "../src/modules/calendar/services/waste/waste.service.ts";
import { type TestUser, addMember, addPlaceholder, createCalendarHousehold, createUser } from "./support/calendar-harness.ts";
import { runTest } from "./support/effect.ts";
import { FLYER_PDF } from "./fixtures/calendar/record-items.ts";

const SLOW = 60_000;
const FLYER = new Uint8Array(readFileSync(FLYER_PDF));
const upload = (tour = 4): WasteSource => ({ kind: "upload", provider: "hattingen", tour, bytes: FLYER, fileName: "AbfallFlyer 2027.pdf" });
/** Tour 4 in 2027: 26 Restmüll, 26 Gelber Sack, 27 Biotonne, 14 Papier, 1 Tannenbaum. */
const TOUR_4_ENTRIES = 94;

const waste = CalendarWaste;
const importFlyer = (householdId: string, userId: string, source: WasteSource = upload()) =>
  runTest(waste.use((service) => service.importFlyer(householdId, userId, source)));

async function entriesOf(importId: string) {
  return db
    .select()
    .from(calendarEntries)
    .where(eq(calendarEntries.wasteImportId, importId))
    .orderBy(asc(calendarEntries.startDate), asc(calendarEntries.category));
}

async function assigneesOf(importId: string): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: calendarEntries.id, date: calendarEntries.startDate, category: calendarEntries.category, mode: calendarEntries.assigneeMode, userId: calendarEntryMembers.userId })
    .from(calendarEntries)
    .leftJoin(calendarEntryMembers, and(eq(calendarEntryMembers.entryId, calendarEntries.id), eq(calendarEntryMembers.role, "assignee")))
    .where(eq(calendarEntries.wasteImportId, importId));
  const out = new Map<string, string | null>();
  for (const row of rows) {
    expect(row.mode).toBe(row.userId === null ? "none" : "fixed");
    out.set(`${row.category}|${row.date}`, row.userId);
  }
  return out;
}

let owner: TestUser;
let robin: TestUser;
let kimId: string;
let householdId: string;

beforeAll(async () => {
  await runTest(migrateDatabase());
  owner = await createUser("waste-owner");
  robin = await createUser("waste-robin");
  householdId = await createCalendarHousehold(owner, "Waste service");
  await addMember(owner, householdId, robin);
  kimId = await addPlaceholder(owner, householdId, "Kim");
});

afterEach(() => setWasteFlyerFetchForTests(null));

describe("assigneeForDay (P15)", () => {
  test("none, fixed and a rotation by pickup day", () => {
    expect(assigneeForDay("none", [], 3)).toBeNull();
    expect(assigneeForDay("fixed", ["a"], 7)).toBe("a");
    expect([0, 1, 2, 3, 4].map((k) => assigneeForDay("rotate", ["a", "b", "c"], k))).toEqual(["a", "b", "c", "a", "b"]);
  });
});

describe("CalendarWaste.importFlyer (P20)", () => {
  test(
    "an upload writes one all-day task per (type, date) of the tour and the settings",
    async () => {
      const result = await importFlyer(householdId, owner.id);
      expect(result.entryCount).toBe(TOUR_4_ENTRIES);
      expect(result.import).toMatchObject({
        provider: "hattingen",
        year: 2027,
        tour: 4,
        source: "upload",
        sourceName: "AbfallFlyer 2027.pdf",
        entryCount: TOUR_4_ENTRIES,
        importedBy: owner.id,
      });
      const rows = await entriesOf(result.import.id);
      expect(rows.length).toBe(TOUR_4_ENTRIES);
      for (const row of rows) {
        expect(row).toMatchObject({
          householdId,
          kind: "task",
          title: null,
          allDay: true,
          startTime: null,
          endTime: null,
          repeatFreq: "none",
          assigneeMode: "none",
          resourceId: null,
          createdBy: owner.id,
        });
        expect(row.endDate).toBe(row.startDate);
        expect(row.category).not.toBeNull();
      }
      expect(rows.filter((row) => row.startDate === "2027-01-04").map((row) => row.category).sort()).toEqual([
        "waste_bio",
        "waste_paper",
        "waste_tree",
      ]);
      expect(rows.find((row) => row.startDate === "2027-07-01" && row.category === "waste_bio")?.categoryDetail).toBe("bio_cleaning");
      const overview = await runTest(waste.use((service) => service.overview(householdId, "2027-01-01")));
      expect(overview.settings).toMatchObject({ provider: "hattingen", tour: 4, sourceUrl: null, assigneeMode: "none", assigneeIds: [] });
    },
    SLOW,
  );

  test(
    "a second import of the year replaces the first and carries the done and skipped marks by (category, date)",
    async () => {
      const first = await importFlyer(householdId, owner.id);
      const rows = await entriesOf(first.import.id);
      const done = rows.find((row) => row.startDate === "2027-01-08" && row.category === "waste_rest")!;
      const skipped = rows.find((row) => row.startDate === "2027-01-04" && row.category === "waste_bio")!;
      await db.insert(calendarOccurrenceStates).values([
        { entryId: done.id, occurrenceDate: done.startDate, status: "done", doneBy: robin.id, updatedAt: 1 },
        { entryId: skipped.id, occurrenceDate: skipped.startDate, status: "skipped", doneBy: null, updatedAt: 2 },
      ]);

      const second = await importFlyer(householdId, robin.id);
      expect(second.import.id).not.toBe(first.import.id);
      const imports = await db.select().from(calendarWasteImports).where(eq(calendarWasteImports.householdId, householdId));
      expect(imports.map((row) => row.id)).toEqual([second.import.id]);
      expect(await entriesOf(first.import.id)).toEqual([]);

      const states = await db
        .select({ category: calendarEntries.category, date: calendarOccurrenceStates.occurrenceDate, status: calendarOccurrenceStates.status, doneBy: calendarOccurrenceStates.doneBy, importId: calendarEntries.wasteImportId })
        .from(calendarOccurrenceStates)
        .innerJoin(calendarEntries, eq(calendarEntries.id, calendarOccurrenceStates.entryId))
        .where(eq(calendarEntries.householdId, householdId))
        .orderBy(asc(calendarOccurrenceStates.occurrenceDate));
      expect(states).toEqual([
        { category: "waste_bio", date: "2027-01-04", status: "skipped", doneBy: null, importId: second.import.id },
        { category: "waste_rest", date: "2027-01-08", status: "done", doneBy: robin.id, importId: second.import.id },
      ]);
    },
    SLOW,
  );

  test(
    "with a rotation in the settings the import assigns per pickup DAY: every type of one day to the same person",
    async () => {
      await runTest(
        waste.use((service) =>
          service.putSettings(householdId, { provider: "hattingen", tour: 4, assigneeMode: "rotate", assigneeIds: [robin.id, kimId], today: "2027-01-01" }),
        ),
      );
      const result = await importFlyer(householdId, owner.id);
      const assigned = await assigneesOf(result.import.id);
      const days = [...new Set([...assigned.keys()].map((key) => key.split("|")[1]!))].sort();
      days.forEach((date, k) => {
        const people = [...assigned].filter(([key]) => key.endsWith(`|${date}`)).map(([, userId]) => userId);
        expect(new Set(people)).toEqual(new Set([k % 2 === 0 ? robin.id : kimId]));
      });
      // 2027-01-04 is tour 4's first pickup day (Biotonne, Papier, Tannenbaum): all three to Robin.
      expect(assigned.get("waste_bio|2027-01-04")).toBe(robin.id);
      expect(assigned.get("waste_tree|2027-01-04")).toBe(robin.id);
      expect(assigned.get("waste_rest|2027-01-08")).toBe(kimId);
    },
    SLOW,
  );

  test(
    "putSettings re-assigns only the entries dated on or after `today`; earlier ones keep their person",
    async () => {
      const result = await importFlyer(householdId, owner.id);
      const before = await assigneesOf(result.import.id);
      const settings = await runTest(
        waste.use((service) =>
          service.putSettings(householdId, { provider: "hattingen", tour: 4, assigneeMode: "fixed", assigneeIds: [owner.id], today: "2027-07-01" }),
        ),
      );
      expect(settings).toMatchObject({ assigneeMode: "fixed", assigneeIds: [owner.id], tour: 4 });
      const after = await assigneesOf(result.import.id);
      for (const [key, userId] of after) {
        const date = key.split("|")[1]!;
        expect(userId).toBe(date >= "2027-07-01" ? owner.id : before.get(key)!);
      }
      await runTest(
        waste.use((service) =>
          service.putSettings(householdId, { provider: "hattingen", tour: 4, assigneeMode: "none", assigneeIds: [], today: "2027-01-01" }),
        ),
      );
      expect([...(await assigneesOf(result.import.id)).values()].every((userId) => userId === null)).toBe(true);
    },
    SLOW,
  );

  test("putSettings refuses a person who is not a member of the household (422 at assigneeIds.<n>)", async () => {
    const stranger = await createUser("waste-stranger");
    const error = await runTest(
      Effect.flip(
        waste.use((service) =>
          service.putSettings(householdId, { provider: "hattingen", tour: 4, assigneeMode: "rotate", assigneeIds: [robin.id, stranger.id], today: "2027-01-01" }),
        ),
      ),
    );
    expect(error).toMatchObject({ status: 422, code: "validation_failed", details: [{ path: "assigneeIds.1" }] });
  });

  test(
    "a URL import stores the URL as source and in the settings (through the test fetch)",
    async () => {
      const url = WASTE_PROVIDERS.hattingen.defaultUrl;
      setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(new Map([[url, FLYER]])));
      const result = await importFlyer(householdId, owner.id, { kind: "url", provider: "hattingen", tour: 4, url });
      expect(result.import).toMatchObject({ source: "url", sourceName: url });
      const overview = await runTest(waste.use((service) => service.overview(householdId, "2027-01-01")));
      expect(overview.settings?.sourceUrl).toBe(url);
      expect(overview.imports.map((row) => row.id)).toEqual([result.import.id]);
    },
    SLOW,
  );
});

describe("CalendarWaste.overview and removeImport (P16)", () => {
  test(
    "next: per type the earliest pickup on or after `from` that is not skipped, in display order",
    async () => {
      // A household of its own: the shared one carries marks from the tests above.
      const fresh = await createCalendarHousehold(owner, "Waste next");
      const result = await importFlyer(fresh, owner.id);
      const first = await runTest(waste.use((service) => service.overview(fresh, "2027-01-05")));
      expect(first.next.map((pickup) => pickup.category)).toEqual(["waste_rest", "waste_yellow", "waste_bio", "waste_paper"]);
      const rest = first.next[0]!;
      expect(rest).toEqual({ category: "waste_rest", date: "2027-01-08", detail: null });

      const entry = (await entriesOf(result.import.id)).find((row) => row.category === "waste_rest" && row.startDate === rest.date)!;
      await db.insert(calendarOccurrenceStates).values({ entryId: entry.id, occurrenceDate: entry.startDate, status: "skipped", doneBy: null, updatedAt: 3 });
      const second = await runTest(waste.use((service) => service.overview(fresh, "2027-01-05")));
      expect(second.next[0]!.category).toBe("waste_rest");
      expect(second.next[0]!.date > rest.date).toBe(true);

      const late = await runTest(waste.use((service) => service.overview(fresh, "2027-12-31")));
      expect(late.next).toEqual([]);
    },
    SLOW,
  );

  test(
    "removeImport deletes the import with its entries; another household's import is 404",
    async () => {
      const other = await createUser("waste-other");
      const otherHousehold = await createCalendarHousehold(other, "Other waste");
      const result = await importFlyer(householdId, owner.id);
      const error = await runTest(Effect.flip(waste.use((service) => service.removeImport(otherHousehold, result.import.id))));
      expect(error).toMatchObject({ status: 404, code: "not_found" });
      expect((await entriesOf(result.import.id)).length).toBe(TOUR_4_ENTRIES);
      await runTest(waste.use((service) => service.removeImport(householdId, result.import.id)));
      expect(await entriesOf(result.import.id)).toEqual([]);
      const overview = await runTest(waste.use((service) => service.overview(householdId, "2027-01-01")));
      expect(overview.imports).toEqual([]);
      expect(overview.next).toEqual([]);
    },
    SLOW,
  );
});
