/**
 * `CalendarOccurrences` (plan m8 M8-T05, M8-T06; P4, P9a, P10, P12): the expansion over the database at the range
 * edges, multi-day entries, the rotation's pick on a ten-year-old series, the filters and the order of P10, the states
 * of P12 and the caps of P4, through the routes and (for the caps) the service on the app runtime.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { addCalendarDays, calendarDaysBetween } from "@toon/shared";
import { Effect, Exit } from "effect";
import { db } from "../src/db/client.ts";
import { calendarEntries, calendarWasteImports } from "../src/modules/calendar/schema.ts";
import { CalendarOccurrences } from "../src/modules/calendar/services/entries/occurrences.service.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import {
  type TestUser,
  addMember,
  addPlaceholder,
  body,
  calendarPath,
  call,
  createCalendarHousehold,
  createUser,
} from "./support/calendar-harness.ts";
import { runTestExit } from "./support/effect.ts";

await runMigrations(db);

interface Occurrence {
  id: string;
  entryId: string;
  kind: string;
  title: string | null;
  category: string | null;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  memberIds: string[];
  assigneeId: string | null;
  status: string;
  doneBy: string | null;
  recurring: boolean;
}

interface ErrorBody {
  error: { code: string; details?: Array<{ path: string; i18n: { key: string } }> };
}

async function household(): Promise<{ owner: TestUser; robin: TestUser; kimId: string; id: string }> {
  const owner = await createUser("Eric");
  const id = await createCalendarHousehold(owner, `Termine ${crypto.randomUUID().slice(0, 6)}`);
  const robin = await createUser("Robin");
  await addMember(owner, id, robin);
  const kimId = await addPlaceholder(owner, id, "Kim");
  return { owner, robin, kimId, id };
}

function client(home: string, cookie: string) {
  return {
    create: async (payload: unknown): Promise<string> => {
      const response = await call(calendarPath(home, "/entries"), { method: "POST", cookie, body: payload });
      if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
      return (await body<{ id: string }>(response)).id;
    },
    occurrences: async (query: string): Promise<{ items: Occurrence[]; members: Array<{ userId: string; colorIndex: number; hasAccount: boolean }> }> => {
      const response = await call(calendarPath(home, `/occurrences?${query}`), { cookie });
      if (response.status !== 200) throw new Error(`list failed: ${response.status} ${await response.text()}`);
      return body(response);
    },
    raw: (query: string) => call(calendarPath(home, `/occurrences?${query}`), { cookie }),
    put: (entryId: string, date: string, status: unknown) =>
      call(calendarPath(home, `/entries/${entryId}/occurrences/${date}`), { method: "PUT", cookie, body: { status } }),
  };
}

describe("expansion over the range", () => {
  let api: ReturnType<typeof client>;
  let weekly = "";
  let trip = "";
  let past = "";

  beforeAll(async () => {
    const h = await household();
    api = client(h.id, h.owner.cookie);
    weekly = await api.create({
      kind: "event",
      title: "Training",
      allDay: false,
      startDate: "2027-01-06",
      startTime: "17:00",
      repeat: { freq: "weekly" },
    });
    trip = await api.create({ kind: "event", title: "Urlaub", allDay: true, startDate: "2027-01-28", endDate: "2027-02-03" });
    past = await api.create({ kind: "event", title: "Vorbei", allDay: true, startDate: "2027-01-01", endDate: "2027-01-02" });
  });

  test("an occurrence on either edge is in, a multi-day entry overlapping the start is in with its own dates", async () => {
    const { items } = await api.occurrences("from=2027-02-03&to=2027-02-10");
    expect(items.map((item) => [item.entryId, item.date, item.endDate])).toEqual([
      [trip, "2027-01-28", "2027-02-03"],
      [weekly, "2027-02-03", "2027-02-03"],
      [weekly, "2027-02-10", "2027-02-10"],
    ]);
    expect(items.some((item) => item.entryId === past)).toBe(false);
    expect(items[1]).toMatchObject({ id: `${weekly}:2027-02-03`, recurring: true, status: "open", doneBy: null });
  });

  test("a one-day window inside a multi-day entry holds it; the day after holds nothing of it", async () => {
    expect((await api.occurrences("from=2027-01-30&to=2027-01-30")).items.map((item) => item.entryId)).toEqual([trip]);
    expect((await api.occurrences("from=2027-02-04&to=2027-02-04")).items).toEqual([]);
  });
});

describe("the rotation's pick on a long series (P3 ordinals)", () => {
  test("a daily rotation started ten years ago picks rotation[ordinal mod n]", async () => {
    const h = await household();
    const api = client(h.id, h.owner.cookie);
    const rotation = [h.owner.id, h.robin.id, h.kimId];
    const daily = await api.create({
      kind: "task",
      title: "Blumen gießen",
      allDay: true,
      startDate: "2017-03-14",
      repeat: { freq: "daily", interval: 3 },
      assigneeMode: "rotate",
      assigneeIds: rotation,
    });
    const { items } = await api.occurrences("from=2027-01-01&to=2027-01-31");
    expect(items.length).toBeGreaterThan(9);
    for (const item of items) {
      const ordinal = calendarDaysBetween("2017-03-14", item.date) / 3;
      expect(Number.isInteger(ordinal)).toBe(true);
      expect([item.date, item.assigneeId]).toEqual([item.date, rotation[ordinal % 3]!]);
      expect(item.entryId).toBe(daily);
    }
  });

  test("a monthly rotation on the 31st counts only the months that have one", async () => {
    const h = await household();
    const api = client(h.id, h.owner.cookie);
    await api.create({
      kind: "task",
      title: "Abrechnung",
      allDay: true,
      startDate: "2027-01-31",
      repeat: { freq: "monthly" },
      assigneeMode: "rotate",
      assigneeIds: [h.owner.id, h.robin.id],
    });
    const { items } = await api.occurrences("from=2027-01-01&to=2027-08-31");
    expect(items.map((item) => [item.date, item.assigneeId])).toEqual([
      ["2027-01-31", h.owner.id],
      ["2027-03-31", h.robin.id],
      ["2027-05-31", h.owner.id],
      ["2027-07-31", h.robin.id],
      ["2027-08-31", h.owner.id],
    ]);
  });
});

describe("filters and order (P10), members (P9a)", () => {
  let h: Awaited<ReturnType<typeof household>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await household();
    api = client(h.id, h.owner.cookie);
    const car = await call(calendarPath(h.id, "/resources"), { method: "POST", cookie: h.owner.cookie, body: { name: "Auto" } });
    const carId = (await body<{ id: string }>(car)).id;
    const day = "2027-05-10";
    ids.everyone = await api.create({ kind: "event", title: "Zoo", allDay: false, startDate: day, startTime: "09:00" });
    ids.robinEvent = await api.create({
      kind: "event",
      title: "Zahnarzt",
      allDay: false,
      startDate: day,
      startTime: "08:00",
      attendeeIds: [h.robin.id],
    });
    ids.kimTask = await api.create({
      kind: "task",
      title: "Bad putzen",
      allDay: true,
      startDate: day,
      assigneeMode: "fixed",
      assigneeIds: [h.kimId],
    });
    ids.openTask = await api.create({ kind: "task", title: "Abwasch", allDay: true, startDate: day });
    ids.car = await api.create({
      kind: "car",
      title: "Arbeit",
      allDay: false,
      startDate: day,
      startTime: "08:00",
      endTime: "17:00",
      attendeeIds: [h.robin.id],
      resourceId: carId,
    });
    const importId = crypto.randomUUID();
    await db.insert(calendarWasteImports).values({
      id: importId,
      householdId: h.id,
      provider: "hattingen",
      year: 2027,
      tour: 4,
      source: "upload",
      sourceName: "t.pdf",
      entryCount: 2,
      importedAt: 1,
    });
    for (const [key, category] of [["bio", "waste_bio"], ["rest", "waste_rest"]] as const) {
      const id = crypto.randomUUID();
      ids[key] = id;
      await db.insert(calendarEntries).values({
        id,
        householdId: h.id,
        kind: "task",
        title: null,
        allDay: true,
        startDate: day,
        endDate: day,
        category,
        wasteImportId: importId,
        createdAt: 1,
        updatedAt: 1,
      });
    }
  });

  test("order: all-day first (waste first, by category order, then by title), then by time, title, entry id", async () => {
    const { items } = await api.occurrences("from=2027-05-10&to=2027-05-10");
    // 08:00 "Arbeit" (the car) before 08:00 "Zahnarzt", then 09:00.
    expect(items.map((item) => item.entryId)).toEqual([
      ids.rest!,
      ids.bio!,
      ids.openTask!,
      ids.kimTask!,
      ids.car!,
      ids.robinEvent!,
      ids.everyone!,
    ]);
  });

  test("memberId keeps what names the member and what names nobody; kind filters by kind", async () => {
    const robin = (await api.occurrences(`from=2027-05-10&to=2027-05-10&memberId=${h.robin.id}`)).items.map((i) => i.entryId);
    expect(robin.sort()).toEqual([ids.rest!, ids.bio!, ids.openTask!, ids.robinEvent!, ids.car!, ids.everyone!].sort());
    const kim = (await api.occurrences(`from=2027-05-10&to=2027-05-10&memberId=${h.kimId}`)).items.map((i) => i.entryId);
    expect(kim.sort()).toEqual([ids.rest!, ids.bio!, ids.openTask!, ids.kimTask!, ids.everyone!].sort());
    const tasks = (await api.occurrences("from=2027-05-10&to=2027-05-10&kind=task")).items.map((i) => i.entryId);
    expect(tasks.sort()).toEqual([ids.rest!, ids.bio!, ids.openTask!, ids.kimTask!].sort());
    const cars = (await api.occurrences("from=2027-05-10&to=2027-05-10&kind=car")).items;
    expect(cars.map((item) => [item.entryId, item.memberIds])).toEqual([[ids.car!, [h.robin.id]]]);
  });

  test("the answer carries the household's members with colours, placeholders without an account", async () => {
    const { members } = await api.occurrences("from=2027-05-10&to=2027-05-10");
    expect(members.map((member) => member.userId).sort()).toEqual([h.owner.id, h.robin.id, h.kimId].sort());
    expect(members.find((member) => member.userId === h.kimId)?.hasAccount).toBe(false);
    for (const member of members) expect(member.colorIndex).toBeGreaterThanOrEqual(1);
  });
});

describe("states (P12)", () => {
  let h: Awaited<ReturnType<typeof household>>;
  let api: ReturnType<typeof client>;
  let task = "";
  let event = "";

  beforeAll(async () => {
    h = await household();
    api = client(h.id, h.owner.cookie);
    task = await api.create({
      kind: "task",
      title: "Blumen gießen",
      allDay: true,
      startDate: "2027-06-01",
      repeat: { freq: "daily", interval: 2 },
    });
    event = await api.create({ kind: "event", title: "Kino", allDay: true, startDate: "2027-06-01", repeat: { freq: "weekly" } });
  });

  test("done stamps the caller, skipped stamps nobody, null resets; the list shows each", async () => {
    const done = await api.put(task, "2027-06-03", "done");
    expect(done.status).toBe(200);
    expect(await body<Occurrence>(done)).toMatchObject({ id: `${task}:2027-06-03`, status: "done", doneBy: h.owner.id, date: "2027-06-03" });
    expect(await body<Occurrence>(await api.put(task, "2027-06-05", "skipped"))).toMatchObject({ status: "skipped", doneBy: null });
    const listed = (await api.occurrences("from=2027-06-01&to=2027-06-05&kind=task")).items;
    expect(listed.map((item) => [item.date, item.status, item.doneBy])).toEqual([
      ["2027-06-01", "open", null],
      ["2027-06-03", "done", h.owner.id],
      ["2027-06-05", "skipped", null],
    ]);
    // Done over skipped, then reset.
    expect((await body<Occurrence>(await api.put(task, "2027-06-05", "done"))).status).toBe("done");
    expect(await body<Occurrence>(await api.put(task, "2027-06-05", null))).toMatchObject({ status: "open", doneBy: null });
    expect((await api.occurrences("from=2027-06-05&to=2027-06-05&kind=task")).items[0]?.status).toBe("open");
  });

  test("done only on a task (409 calendar_not_a_task), skipped on any kind", async () => {
    const refused = await api.put(event, "2027-06-08", "done");
    expect(refused.status).toBe(409);
    expect((await body<ErrorBody>(refused)).error.code).toBe("calendar_not_a_task");
    expect((await body<Occurrence>(await api.put(event, "2027-06-08", "skipped"))).status).toBe("skipped");
  });

  test("a date that is no occurrence start, a malformed date and an unknown entry are 404", async () => {
    for (const [entryId, date] of [
      [task, "2027-06-02"],
      [task, "2027-05-30"],
      [task, "2027-02-30"],
      [task, "heute"],
      [crypto.randomUUID(), "2027-06-01"],
    ] as const) {
      const response = await api.put(entryId, date, "skipped");
      expect([date, response.status]).toEqual([date, 404]);
      expect((await body<ErrorBody>(response)).error.code).toBe("not_found");
    }
    const bad = await api.put(task, "2027-06-01", "later");
    expect(bad.status).toBe(422);
  });
});

describe("caps (P4)", () => {
  let h: Awaited<ReturnType<typeof household>>;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    h = await household();
    api = client(h.id, h.owner.cookie);
  });

  test("400 days inclusive are fine, 401 are 422 calendar_range_too_large at `to`", async () => {
    const from = "2027-01-01";
    expect((await api.raw(`from=${from}&to=${addCalendarDays(from, 399)}`)).status).toBe(200);
    const refused = await api.raw(`from=${from}&to=${addCalendarDays(from, 400)}`);
    expect(refused.status).toBe(422);
    const payload = await body<ErrorBody>(refused);
    expect(payload.error.code).toBe("calendar_range_too_large");
    expect(payload.error.details?.map((item) => [item.path, item.i18n.key])).toEqual([["to", "server.calendar.rangeTooLarge"]]);
  });

  test("`to` before `from` and a malformed date are 422 validation_failed", async () => {
    const reversed = await api.raw("from=2027-02-01&to=2027-01-31");
    expect(reversed.status).toBe(422);
    const payload = await body<ErrorBody>(reversed);
    expect(payload.error.code).toBe("validation_failed");
    expect(payload.error.details?.map((item) => [item.path, item.i18n.key])).toEqual([["to", "server.calendar.rangeOrder"]]);
    expect((await api.raw("from=2027-02-30&to=2027-03-01")).status).toBe(422);
    expect((await api.raw("to=2027-03-01")).status).toBe(422);
  });

  test("an entry expanding to more than 2000 occurrences in the range is refused, never truncated", async () => {
    // A daily series whose occurrences last 3000 days: every window overlaps thousands of them.
    await api.create({
      kind: "event",
      title: "Dauerbrenner",
      allDay: true,
      startDate: "2020-01-01",
      endDate: addCalendarDays("2020-01-01", 3000),
      repeat: { freq: "daily" },
    });
    const refused = await api.raw("from=2027-01-01&to=2027-01-10");
    expect(refused.status).toBe(422);
    const payload = await body<ErrorBody>(refused);
    expect(payload.error.code).toBe("calendar_range_too_large");
    expect(payload.error.details?.map((item) => [item.path, item.i18n.key])).toEqual([
      ["to", "server.calendar.tooManyOccurrences"],
    ]);
    const exit = await runTestExit(
      CalendarOccurrences.use((service) => service.list(h.id, { from: "2027-01-01", to: "2027-01-02" })),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const tagged = await runTestExit(
      CalendarOccurrences.use((service) => service.list(h.id, { from: "2027-01-01", to: "2027-01-02" })).pipe(
        Effect.catchTag("ApiFailure", (error) => Effect.succeed(error.code)),
      ),
    );
    expect(tagged).toEqual(Exit.succeed("calendar_range_too_large"));
  });
});
