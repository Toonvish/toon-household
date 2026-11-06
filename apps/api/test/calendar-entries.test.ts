/**
 * `CalendarEntries` through the routes (plan m8 M8-T05, M8-T06; P6, P7, P8, P9b): the P6 rules row by row as the API
 * answers them (`422 validation_failed`, each `details` item at its path with its `server.calendar.*` key), the
 * database's rules (members of THIS household, the car), the P7 merge with the deletion of orphaned states, the P8
 * refusals on a hand-inserted waste entry, the list filters, and the confirmed-address gate on writes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";
import { calendarEntries, calendarOccurrenceStates, calendarWasteImports } from "../src/modules/calendar/schema.ts";
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

await runMigrations(db);

interface Entry {
  id: string;
  kind: string;
  title: string | null;
  notes: string | null;
  location: string | null;
  allDay: boolean;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  repeat: { freq: string; interval: number; weekdays: string[]; until: string | null };
  attendeeIds: string[];
  assigneeMode: string;
  assigneeIds: string[];
  resourceId: string | null;
  category: string | null;
  wasteImportId: string | null;
  createdBy: string | null;
}

interface ErrorBody {
  error: { code: string; details?: Array<{ path: string; code: string; message: string; i18n: { key: string } }> };
}

let owner: TestUser;
let robin: TestUser;
let kimId = "";
let householdId = "";
let carId = "";
let archivedCarId = "";
let stranger: TestUser;
let foreignCarId = "";

const as = () => ({ cookie: owner.cookie });

async function post(path: string, payload: unknown): Promise<Response> {
  return call(calendarPath(householdId, path), { method: "POST", ...as(), body: payload });
}

async function patch(path: string, payload: unknown): Promise<Response> {
  return call(calendarPath(householdId, path), { method: "PATCH", ...as(), body: payload });
}

async function created(payload: unknown): Promise<Entry> {
  const response = await post("/entries", payload);
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return body<Entry>(response);
}

/** The `[path, key]` pairs of a 422. */
async function refusal(response: Response): Promise<Array<[string, string]>> {
  expect(response.status).toBe(422);
  const payload = await body<ErrorBody>(response);
  expect(payload.error.code).toBe("validation_failed");
  return (payload.error.details ?? []).map((item) => [item.path, item.i18n.key]);
}

beforeAll(async () => {
  owner = await createUser("Eric");
  householdId = await createCalendarHousehold(owner, "Kalender Familie");
  robin = await createUser("Robin");
  await addMember(owner, householdId, robin);
  kimId = await addPlaceholder(owner, householdId, "Kim");
  carId = (await body<{ id: string }>(await post("/resources", { name: "Familienauto" }))).id;
  archivedCarId = (await body<{ id: string }>(await post("/resources", { name: "Alter Golf" }))).id;
  await patch(`/resources/${archivedCarId}`, { archived: true });

  stranger = await createUser("Fremd");
  const otherHousehold = await createCalendarHousehold(stranger, "Andere");
  const response = await call(calendarPath(otherHousehold, "/resources"), {
    method: "POST",
    cookie: stranger.cookie,
    body: { name: "Fremdes Auto" },
  });
  foreignCarId = (await body<{ id: string }>(response)).id;
});

const event = { kind: "event", title: "Elternabend", allDay: false, startDate: "2027-01-05", startTime: "19:30" };
const task = { kind: "task", title: "Blumen gießen", allDay: true, startDate: "2027-01-05" };
const car = () => ({
  kind: "car",
  title: "Arbeit",
  allDay: false,
  startDate: "2027-01-07",
  startTime: "08:00",
  endTime: "17:00",
  attendeeIds: [robin.id],
  resourceId: carId,
});

describe("create (P6)", () => {
  test("an event answers 201 with every field, nullable ones null, the rhythm filled in", async () => {
    const entry = await created(event);
    expect(entry).toMatchObject({
      kind: "event",
      title: "Elternabend",
      notes: null,
      location: null,
      allDay: false,
      startDate: "2027-01-05",
      startTime: "19:30",
      endDate: "2027-01-05",
      endTime: null,
      repeat: { freq: "none", interval: 1, weekdays: [], until: null },
      attendeeIds: [],
      assigneeMode: "none",
      assigneeIds: [],
      resourceId: null,
      category: null,
      wasteImportId: null,
      createdBy: owner.id,
    });
    const read = await call(calendarPath(householdId, `/entries/${entry.id}`), as());
    expect(read.status).toBe(200);
    expect(await body<Entry>(read)).toEqual(entry);
  });

  test("a weekly task rotating over a member and a placeholder; a car booking", async () => {
    const rotating = await created({
      ...task,
      repeat: { freq: "weekly", interval: 2, weekdays: ["TH", "MO"] },
      assigneeMode: "rotate",
      assigneeIds: [robin.id, kimId, owner.id],
    });
    expect(rotating.repeat).toEqual({ freq: "weekly", interval: 2, weekdays: ["MO", "TH"], until: null });
    expect(rotating.assigneeIds).toEqual([robin.id, kimId, owner.id]);
    const booking = await created({ ...car(), startDate: "2027-03-01" });
    expect(booking).toMatchObject({ kind: "car", resourceId: carId, attendeeIds: [robin.id], endTime: "17:00" });
  });

  test("the P6 table, row by row", async () => {
    const cases: Array<[unknown, Array<[string, string]>]> = [
      [{ ...event, startTime: undefined }, [["startTime", "server.calendar.timeRequired"]]],
      [{ ...event, allDay: true }, [["startTime", "server.calendar.allDayNoTime"]]],
      [{ ...event, endTime: "19:00" }, [["endTime", "server.calendar.endBeforeStart"]]],
      [{ ...event, endDate: "2027-01-04" }, [["endDate", "server.calendar.endBeforeStart"]]],
      [{ ...event, assigneeMode: "fixed" }, [["assigneeMode", "server.calendar.assigneesOnlyTasks"]]],
      [{ ...event, resourceId: carId }, [["resourceId", "server.calendar.resourceOnlyCars"]]],
      [{ ...event, attendeeIds: [robin.id, robin.id] }, [["attendeeIds", "server.calendar.duplicateIds"]]],
      [{ ...task, endDate: "2027-01-06" }, [["endDate", "server.calendar.taskSingleDay"]]],
      [{ ...task, attendeeIds: [robin.id] }, [["attendeeIds", "server.calendar.attendeesNotOnTasks"]]],
      [{ ...task, assigneeMode: "fixed", assigneeIds: [robin.id, kimId] }, [["assigneeIds", "server.calendar.fixedNeedsOne"]]],
      [{ ...task, assigneeMode: "rotate", assigneeIds: [robin.id] }, [["assigneeIds", "server.calendar.rotateNeedsTwo"]]],
      [{ ...task, assigneeIds: [robin.id] }, [["assigneeIds", "server.calendar.assigneesForNone"]]],
      [{ ...task, repeat: { freq: "daily", until: "2027-01-01" } }, [["repeat.until", "server.calendar.untilBeforeStart"]]],
      [{ ...task, repeat: { freq: "daily", weekdays: ["MO"] } }, [["repeat.weekdays", "server.calendar.weekdaysOnlyWeekly"]]],
      [{ ...car(), resourceId: null }, [["resourceId", "server.calendar.carNeedsResource"]]],
      [{ ...car(), attendeeIds: [] }, [["attendeeIds", "server.calendar.carNeedsOnePerson"]]],
      [{ ...car(), endTime: null }, [["endTime", "server.calendar.timeRequired"]]],
      [{ ...event, startDate: "2027-02-29" }, [["startDate", "server.calendar.invalidDate"]]],
    ];
    for (const [input, expected] of cases) {
      expect([input, await refusal(await post("/entries", input))]).toEqual([input, expected]);
    }
  });

  test("a member of another household is 422 at its index; a foreign car 404; an archived car 422", async () => {
    expect(await refusal(await post("/entries", { ...event, attendeeIds: [robin.id, stranger.id] }))).toEqual([
      ["attendeeIds.1", "server.calendar.memberNotInHousehold"],
    ]);
    expect(
      await refusal(await post("/entries", { ...task, assigneeMode: "fixed", assigneeIds: [stranger.id] })),
    ).toEqual([["assigneeIds.0", "server.calendar.memberNotInHousehold"]]);
    const foreign = await post("/entries", { ...car(), resourceId: foreignCarId });
    expect(foreign.status).toBe(404);
    expect((await body<ErrorBody>(foreign)).error.code).toBe("not_found");
    expect(await refusal(await post("/entries", { ...car(), resourceId: archivedCarId }))).toEqual([
      ["resourceId", "server.calendar.resourceArchived"],
    ]);
  });

  test("an empty body is refused before anything is written", async () => {
    const before = await db.select().from(calendarEntries).where(eq(calendarEntries.householdId, householdId));
    expect(await refusal(await post("/entries", {}))).toContainEqual(["kind", expect.any(String)]);
    const after = await db.select().from(calendarEntries).where(eq(calendarEntries.householdId, householdId));
    expect(after.length).toBe(before.length);
  });
});

describe("get, list (P9b), delete", () => {
  test("an unknown id is 404 not_found", async () => {
    const response = await call(calendarPath(householdId, `/entries/${crypto.randomUUID()}`), as());
    expect(response.status).toBe(404);
    expect((await body<ErrorBody>(response)).error.code).toBe("not_found");
  });

  test("list filters by kind and rhythm and never lists waste entries", async () => {
    const owner2 = await createUser("Lister");
    const home = await createCalendarHousehold(owner2, "Listen");
    const send = (payload: unknown) =>
      call(calendarPath(home, "/entries"), { method: "POST", cookie: owner2.cookie, body: payload });
    const single = await body<Entry>(await send({ kind: "event", title: "Arzt", allDay: true, startDate: "2027-02-01" }));
    const series = await body<Entry>(
      await send({ kind: "task", title: "Bad putzen", allDay: true, startDate: "2027-02-06", repeat: { freq: "weekly" } }),
    );
    await insertWasteEntry(home, owner2.id);
    const list = async (query: string) =>
      (await body<{ items: Entry[] }>(await call(calendarPath(home, `/entries${query}`), { cookie: owner2.cookie }))).items.map(
        (item) => item.id,
      );
    expect(await list("")).toEqual([single.id, series.id]);
    expect(await list("?kind=task")).toEqual([series.id]);
    expect(await list("?recurring=true")).toEqual([series.id]);
    expect(await list("?recurring=false")).toEqual([single.id]);
    const refused = await call(calendarPath(home, "/entries?kind=nope"), { cookie: owner2.cookie });
    expect(refused.status).toBe(422);
  });

  test("DELETE answers 204 and the series is gone with its states", async () => {
    const entry = await created({ ...task, repeat: { freq: "daily" } });
    await call(calendarPath(householdId, `/entries/${entry.id}/occurrences/2027-01-06`), {
      method: "PUT",
      ...as(),
      body: { status: "done" },
    });
    const response = await call(calendarPath(householdId, `/entries/${entry.id}`), { method: "DELETE", ...as() });
    expect(response.status).toBe(204);
    expect((await call(calendarPath(householdId, `/entries/${entry.id}`), as())).status).toBe(404);
    expect(await db.select().from(calendarOccurrenceStates).where(eq(calendarOccurrenceStates.entryId, entry.id))).toEqual([]);
  });
});

describe("update: merge-then-validate (P7)", () => {
  test("a partial body keeps every other field; an empty body changes nothing", async () => {
    const entry = await created({ ...event, location: "Schule", notes: "Zettel mitnehmen" });
    const renamed = await body<Entry>(await patch(`/entries/${entry.id}`, { title: "  Elternsprechtag " }));
    expect(renamed).toMatchObject({ title: "Elternsprechtag", location: "Schule", notes: "Zettel mitnehmen", startTime: "19:30" });
    const same = await patch(`/entries/${entry.id}`, {});
    expect(same.status).toBe(200);
    expect((await body<Entry>(same)).title).toBe("Elternsprechtag");
    const cleared = await body<Entry>(await patch(`/entries/${entry.id}`, { location: null }));
    expect(cleared.location).toBeNull();
  });

  test("the merged entry is checked with the create rules", async () => {
    const entry = await created(event);
    expect(await refusal(await patch(`/entries/${entry.id}`, { allDay: true }))).toEqual([
      ["startTime", "server.calendar.allDayNoTime"],
    ]);
    const allDay = await body<Entry>(await patch(`/entries/${entry.id}`, { allDay: true, startTime: null }));
    expect(allDay).toMatchObject({ allDay: true, startTime: null, endTime: null });
    expect(await refusal(await patch(`/entries/${entry.id}`, { attendeeIds: [stranger.id] }))).toEqual([
      ["attendeeIds.0", "server.calendar.memberNotInHousehold"],
    ]);
    const unknown = await patch(`/entries/${crypto.randomUUID()}`, { title: "x" });
    expect(unknown.status).toBe(404);
  });

  test("a task becomes a rotation; the kind never changes", async () => {
    const entry = await created(task);
    const rotating = await body<Entry>(
      await patch(`/entries/${entry.id}`, { assigneeMode: "rotate", assigneeIds: [kimId, robin.id], kind: "event" }),
    );
    expect(rotating).toMatchObject({ kind: "task", assigneeMode: "rotate", assigneeIds: [kimId, robin.id] });
    const fixed = await body<Entry>(await patch(`/entries/${entry.id}`, { assigneeMode: "fixed", assigneeIds: [robin.id] }));
    expect(fixed).toMatchObject({ assigneeMode: "fixed", assigneeIds: [robin.id] });
  });

  test("a schedule change deletes the states of dates that are no longer occurrences, and keeps the others", async () => {
    const entry = await created({ ...task, startDate: "2027-01-04", repeat: { freq: "daily" } });
    for (const date of ["2027-01-04", "2027-01-05", "2027-01-06"]) {
      const response = await call(calendarPath(householdId, `/entries/${entry.id}/occurrences/${date}`), {
        method: "PUT",
        ...as(),
        body: { status: "done" },
      });
      expect(response.status).toBe(200);
    }
    const states = async () =>
      (await db.select().from(calendarOccurrenceStates).where(eq(calendarOccurrenceStates.entryId, entry.id)))
        .map((row) => row.occurrenceDate)
        .sort();
    // A title change is no schedule change: every state stays.
    await patch(`/entries/${entry.id}`, { title: "Blumen" });
    expect(await states()).toEqual(["2027-01-04", "2027-01-05", "2027-01-06"]);
    // Every second day from the 4th: the 5th is no occurrence any more.
    const response = await patch(`/entries/${entry.id}`, { repeat: { freq: "daily", interval: 2 } });
    expect(response.status).toBe(200);
    expect(await states()).toEqual(["2027-01-04", "2027-01-06"]);
  });
});

/** A waste import with one entry (Restmüll on 2027-01-04), written directly as the waste lane will (P20). */
async function insertWasteEntry(home: string, userId: string): Promise<{ importId: string; entryId: string }> {
  const importId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  await db.insert(calendarWasteImports).values({
    id: importId,
    householdId: home,
    provider: "hattingen",
    year: 2027,
    tour: 4,
    source: "upload",
    sourceName: "test.pdf",
    entryCount: 1,
    importedAt: 1,
    importedBy: userId,
  });
  await db.insert(calendarEntries).values({
    id: entryId,
    householdId: home,
    kind: "task",
    title: null,
    allDay: true,
    startDate: "2027-01-04",
    endDate: "2027-01-04",
    category: "waste_rest",
    wasteImportId: importId,
    createdAt: 1,
    updatedAt: 1,
  });
  return { importId, entryId };
}

describe("imported waste entries are read-mostly (P8)", () => {
  test("PATCH takes notes and assignees only; anything else and DELETE are 409 calendar_entry_imported", async () => {
    const { entryId } = await insertWasteEntry(householdId, owner.id);
    const path = `/entries/${entryId}`;
    for (const payload of [{ title: "Müll" }, { startDate: "2027-01-05" }, { notes: "x", repeat: { freq: "daily" } }]) {
      const response = await patch(path, payload);
      expect([payload, response.status]).toEqual([payload, 409]);
      expect((await body<ErrorBody>(response)).error.code).toBe("calendar_entry_imported");
    }
    const noted = await body<Entry>(await patch(path, { notes: "Tonne klemmt", assigneeMode: "fixed", assigneeIds: [robin.id] }));
    expect(noted).toMatchObject({
      title: null,
      category: "waste_rest",
      notes: "Tonne klemmt",
      assigneeMode: "fixed",
      assigneeIds: [robin.id],
      startDate: "2027-01-04",
    });
    expect(await refusal(await patch(path, { assigneeMode: "fixed", assigneeIds: [] }))).toEqual([
      ["assigneeIds", "server.calendar.fixedNeedsOne"],
    ]);
    const removed = await call(calendarPath(householdId, path), { method: "DELETE", ...as() });
    expect(removed.status).toBe(409);
    expect((await body<ErrorBody>(removed)).error.code).toBe("calendar_entry_imported");
    const tick = await call(calendarPath(householdId, `${path}/occurrences/2027-01-04`), {
      method: "PUT",
      ...as(),
      body: { status: "done" },
    });
    expect(tick.status).toBe(200);
  });
});

describe("unconfirmed accounts are read-only", () => {
  beforeAll(() => setVerifiedEmailRequired(true));
  afterAll(() => setVerifiedEmailRequired(null));

  test("a write answers 403 email_unverified, a read passes", async () => {
    const user = await createUser("Unbestaetigt");
    const home = await createCalendarHousehold(user, "Gesperrt");
    await db.update(users).set({ emailVerified: false, emailVerifiedAt: null }).where(eq(users.id, user.id));
    const write = await call(calendarPath(home, "/entries"), { method: "POST", cookie: user.cookie, body: event });
    expect(write.status).toBe(403);
    expect((await body<ErrorBody>(write)).error.code).toBe("email_unverified");
    const read = await call(calendarPath(home, "/entries"), { cookie: user.cookie });
    expect(read.status).toBe(200);
  });
});
