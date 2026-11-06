/**
 * The calendar's member-removal hook (plan m8 M8-T07, P14) through the core route `DELETE
 * /api/households/:householdId/members/:userId`: the leaving member's attendee and assignee rows go, the remaining
 * positions are renumbered, a rotation left with one person becomes `fixed` and a rule left with nobody `none`
 * (entries and waste settings alike), car bookings keep their row, `done_by` keeps the id, another household of the
 * same member is untouched, and a placeholder's removal is never vetoed.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import {
  calendarEntries,
  calendarEntryMembers,
  calendarOccurrenceStates,
  calendarWasteAssignees,
  calendarWasteSettings,
} from "../src/modules/calendar/schema.ts";
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
  attendeeIds: string[];
  assigneeMode: string;
  assigneeIds: string[];
  resourceId: string | null;
}

let owner: TestUser;
let robin: TestUser;
let anna: TestUser;
let kimId = "";
let householdId = "";
let otherHouseholdId = "";
const ids: Record<string, string> = {};

async function create(home: string, cookie: string, payload: unknown): Promise<string> {
  const response = await call(calendarPath(home, "/entries"), { method: "POST", cookie, body: payload });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return (await body<{ id: string }>(response)).id;
}

async function entry(id: string): Promise<Entry> {
  return body<Entry>(await call(calendarPath(householdId, `/entries/${id}`), { cookie: owner.cookie }));
}

const task = { kind: "task", title: "Aufgabe", allDay: true, startDate: "2027-03-01", repeat: { freq: "daily" } };

beforeAll(async () => {
  owner = await createUser("Eric");
  householdId = await createCalendarHousehold(owner, "Familie");
  robin = await createUser("Robin");
  anna = await createUser("Anna");
  await addMember(owner, householdId, robin);
  await addMember(owner, householdId, anna);
  kimId = await addPlaceholder(owner, householdId, "Kim");
  const c = owner.cookie;

  ids.event = await create(householdId, c, {
    kind: "event",
    title: "Kino",
    allDay: true,
    startDate: "2027-03-01",
    attendeeIds: [robin.id, anna.id],
  });
  ids.rotateThree = await create(householdId, c, { ...task, assigneeMode: "rotate", assigneeIds: [owner.id, robin.id, anna.id] });
  ids.rotateTwo = await create(householdId, c, { ...task, assigneeMode: "rotate", assigneeIds: [robin.id, kimId] });
  ids.fixed = await create(householdId, c, { ...task, assigneeMode: "fixed", assigneeIds: [robin.id] });
  ids.kimFixed = await create(householdId, c, { ...task, assigneeMode: "fixed", assigneeIds: [kimId] });
  const car = await call(calendarPath(householdId, "/resources"), { method: "POST", cookie: c, body: { name: "Auto" } });
  const carId = (await body<{ id: string }>(car)).id;
  ids.car = await create(householdId, c, {
    kind: "car",
    title: "Arbeit",
    allDay: true,
    startDate: "2027-03-02",
    attendeeIds: [robin.id],
    resourceId: carId,
  });
  const done = await call(calendarPath(householdId, `/entries/${ids.fixed}/occurrences/2027-03-01`), {
    method: "PUT",
    cookie: robin.cookie,
    body: { status: "done" },
  });
  expect(done.status).toBe(200);

  await db.insert(calendarWasteSettings).values({ householdId, provider: "hattingen", tour: 4, assigneeMode: "rotate", updatedAt: 1 });
  await db.insert(calendarWasteAssignees).values([
    { householdId, userId: robin.id, position: 0 },
    { householdId, userId: owner.id, position: 1 },
  ]);

  // Robin in a second household, which the removal must not touch.
  const other = await createUser("Zweit");
  otherHouseholdId = await createCalendarHousehold(other, "Zweithaushalt");
  await addMember(other, otherHouseholdId, robin);
  ids.otherEvent = await create(otherHouseholdId, other.cookie, {
    kind: "event",
    title: "Anderswo",
    allDay: true,
    startDate: "2027-03-01",
    attendeeIds: [robin.id],
  });
});

describe("removing a member (P14)", () => {
  test("the route answers without a veto and every rule is cleaned up", async () => {
    const response = await call(`/api/households/${householdId}/members/${robin.id}`, { method: "DELETE", cookie: owner.cookie });
    expect(response.status).toBeLessThan(300);

    expect((await entry(ids.event!)).attendeeIds).toEqual([anna.id]);
    expect(await entry(ids.rotateThree!)).toMatchObject({ assigneeMode: "rotate", assigneeIds: [owner.id, anna.id] });
    expect(await entry(ids.rotateTwo!)).toMatchObject({ assigneeMode: "fixed", assigneeIds: [kimId] });
    expect(await entry(ids.fixed!)).toMatchObject({ assigneeMode: "none", assigneeIds: [] });
    // The car booking stays, without a person.
    expect(await entry(ids.car!)).toMatchObject({ attendeeIds: [] });
    expect((await entry(ids.car!)).resourceId).not.toBeNull();
    // Positions are renumbered 0..n-1.
    const positions = await db
      .select({ userId: calendarEntryMembers.userId, position: calendarEntryMembers.position })
      .from(calendarEntryMembers)
      .where(eq(calendarEntryMembers.entryId, ids.rotateThree!))
      .orderBy(asc(calendarEntryMembers.position));
    expect(positions).toEqual([
      { userId: owner.id, position: 0 },
      { userId: anna.id, position: 1 },
    ]);
    // `done_by` keeps the former member's id.
    const states = await db.select().from(calendarOccurrenceStates).where(eq(calendarOccurrenceStates.entryId, ids.fixed!));
    expect(states.map((state) => state.doneBy)).toEqual([robin.id]);
  });

  test("the waste rotation loses the member and degrades to fixed", async () => {
    const assignees = await db.select().from(calendarWasteAssignees).where(eq(calendarWasteAssignees.householdId, householdId));
    expect(assignees.map((row) => [row.userId, row.position])).toEqual([[owner.id, 0]]);
    const settings = await db.select().from(calendarWasteSettings).where(eq(calendarWasteSettings.householdId, householdId));
    expect(settings[0]?.assigneeMode).toBe("fixed");
  });

  test("the member's other household is untouched", async () => {
    const rows = await db.select().from(calendarEntryMembers).where(eq(calendarEntryMembers.entryId, ids.otherEvent!));
    expect(rows.map((row) => row.userId)).toEqual([robin.id]);
  });

  test("a placeholder's removal is not vetoed; their fixed task falls back to nobody", async () => {
    const response = await call(`/api/households/${householdId}/members/${kimId}`, { method: "DELETE", cookie: owner.cookie });
    expect(response.status).toBeLessThan(300);
    expect(await entry(ids.kimFixed!)).toMatchObject({ assigneeMode: "none", assigneeIds: [] });
    expect(await entry(ids.rotateTwo!)).toMatchObject({ assigneeMode: "none", assigneeIds: [] });
    const rows = await db.select().from(calendarEntries).where(eq(calendarEntries.householdId, householdId));
    expect(rows.length).toBe(6);
  });

  test("the last waste assignee leaving leaves no rule", async () => {
    const leaver = await createUser("Geht");
    const home = await createCalendarHousehold(owner, "Muell");
    await addMember(owner, home, leaver);
    await db.insert(calendarWasteSettings).values({ householdId: home, provider: "hattingen", tour: 2, assigneeMode: "fixed", updatedAt: 1 });
    await db.insert(calendarWasteAssignees).values({ householdId: home, userId: leaver.id, position: 0 });
    const response = await call(`/api/households/${home}/members/${leaver.id}`, { method: "DELETE", cookie: leaver.cookie });
    expect(response.status).toBeLessThan(300);
    const settings = await db.select().from(calendarWasteSettings).where(eq(calendarWasteSettings.householdId, home));
    expect(settings[0]?.assigneeMode).toBe("none");
    expect(await db.select().from(calendarWasteAssignees).where(eq(calendarWasteAssignees.householdId, home))).toEqual([]);
  });
});
