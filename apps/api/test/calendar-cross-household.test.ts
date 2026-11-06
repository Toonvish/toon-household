/**
 * The cross-household sweep of the calendar's entries, occurrences and resources (SPEC D8, plan m8 M8-T08).
 *
 * User U owns household A, user V owns household B; both have the calendar enabled and B holds one of everything that
 * has an id: an event, a task with a marked occurrence, a car with a booking. With U's cookie EVERY by-id route under
 * `/api/households/A/calendar/…` of `entries.api.ts`, `occurrences.api.ts` and `resources.api.ts` is addressed with B's
 * ids and must answer `404 not_found` (never 200, never 403, never an empty 204): the household comes from
 * `:householdId` only and every lookup filters by it. A create or PATCH naming B's car is 404 too (as finance's foreign
 * `categoryId`); one naming B's owner as a person is `422 validation_failed` with `server.calendar.memberNotInHousehold`
 * (not a member of A). B's rows are unchanged afterwards, and A's lists never show them.
 *
 * A coverage test reads those three `.api.ts` files and fails when a declared `:param` endpoint has no probe, so a
 * route added later cannot silently skip the sweep. The waste routes have their own sweep (lane api-waste).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import {
  calendarEntries,
  calendarEntryMembers,
  calendarOccurrenceStates,
  calendarResources,
} from "../src/modules/calendar/schema.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { type TestUser, body, calendarPath, call, createCalendarHousehold, createUser } from "./support/calendar-harness.ts";

await runMigrations(db);

interface Side {
  owner: TestUser;
  householdId: string;
  eventId: string;
  taskId: string;
  carId: string;
  bookingId: string;
}

const DATE = "2027-04-05";

async function expectOk<T>(response: Response, status: number): Promise<T> {
  if (response.status !== status) throw new Error(`setup failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** One of everything with an id, created through the API. */
async function seedSide(label: string): Promise<Side> {
  const owner = await createUser(`${label}owner`);
  const householdId = await createCalendarHousehold(owner, `${label} ${crypto.randomUUID().slice(0, 8)}`);
  const send = (path: string, payload: unknown) =>
    call(calendarPath(householdId, path), { method: "POST", cookie: owner.cookie, body: payload });
  const event = await expectOk<{ id: string }>(
    await send("/entries", { kind: "event", title: `Termin ${label}`, allDay: true, startDate: DATE, attendeeIds: [owner.id] }),
    201,
  );
  const task = await expectOk<{ id: string }>(
    await send("/entries", {
      kind: "task",
      title: `Aufgabe ${label}`,
      allDay: true,
      startDate: DATE,
      repeat: { freq: "daily" },
      assigneeMode: "fixed",
      assigneeIds: [owner.id],
    }),
    201,
  );
  await expectOk(
    await call(calendarPath(householdId, `/entries/${task.id}/occurrences/${DATE}`), {
      method: "PUT",
      cookie: owner.cookie,
      body: { status: "done" },
    }),
    200,
  );
  const car = await expectOk<{ id: string }>(await send("/resources", { name: `Auto ${label}` }), 201);
  const booking = await expectOk<{ id: string }>(
    await send("/entries", {
      kind: "car",
      title: `Fahrt ${label}`,
      allDay: true,
      startDate: DATE,
      attendeeIds: [owner.id],
      resourceId: car.id,
    }),
    201,
  );
  return { owner, householdId, eventId: event.id, taskId: task.id, carId: car.id, bookingId: booking.id };
}

interface Probe {
  label: string;
  method: string;
  /** Under `/api/households/A/calendar`. */
  path: string;
  body?: unknown;
  status: number;
  code: string;
}

let a: Side;
let b: Side;

beforeAll(async () => {
  a = await seedSide("A");
  b = await seedSide("B");
});

function probes(): Probe[] {
  const notFound = { status: 404, code: "not_found" } as const;
  const notMember = { status: 422, code: "validation_failed" } as const;
  return [
    { label: "GET entry", method: "GET", path: `/entries/${b.eventId}`, ...notFound },
    { label: "PATCH entry", method: "PATCH", path: `/entries/${b.eventId}`, body: { title: "gehackt" }, ...notFound },
    { label: "DELETE entry", method: "DELETE", path: `/entries/${b.eventId}`, ...notFound },
    { label: "GET booking", method: "GET", path: `/entries/${b.bookingId}`, ...notFound },
    {
      label: "PUT occurrence state",
      method: "PUT",
      path: `/entries/${b.taskId}/occurrences/${DATE}`,
      body: { status: null },
      ...notFound,
    },
    { label: "PATCH car", method: "PATCH", path: `/resources/${b.carId}`, body: { name: "gehackt" }, ...notFound },
    { label: "DELETE car", method: "DELETE", path: `/resources/${b.carId}`, ...notFound },
    {
      label: "POST booking of B's car",
      method: "POST",
      path: "/entries",
      body: { kind: "car", title: "Fremd", allDay: true, startDate: "2027-05-01", attendeeIds: [a.owner.id], resourceId: b.carId },
      ...notFound,
    },
    {
      label: "PATCH own booking onto B's car",
      method: "PATCH",
      path: `/entries/${a.bookingId}`,
      body: { resourceId: b.carId },
      ...notFound,
    },
    {
      label: "POST event naming B's owner",
      method: "POST",
      path: "/entries",
      body: { kind: "event", title: "Fremd", allDay: true, startDate: "2027-05-01", attendeeIds: [b.owner.id] },
      ...notMember,
    },
    {
      label: "PATCH own task assigning B's owner",
      method: "PATCH",
      path: `/entries/${a.taskId}`,
      body: { assigneeMode: "fixed", assigneeIds: [b.owner.id] },
      ...notMember,
    },
  ];
}

async function send(probe: Probe, cookie: string): Promise<Response> {
  return call(calendarPath(a.householdId, probe.path), { method: probe.method, cookie, body: probe.body });
}

/** Everything of B's that a refused request could have touched, by value. */
async function snapshotOfB(): Promise<unknown> {
  const entries = await db.select().from(calendarEntries).where(eq(calendarEntries.householdId, b.householdId));
  const ids = entries.map((entry) => entry.id);
  return {
    entries,
    members: await db.select().from(calendarEntryMembers).where(inArray(calendarEntryMembers.entryId, ids)),
    states: await db.select().from(calendarOccurrenceStates).where(inArray(calendarOccurrenceStates.entryId, ids)),
    resources: await db.select().from(calendarResources).where(eq(calendarResources.householdId, b.householdId)),
  };
}

describe("calendar cross-household sweep (SPEC D8)", () => {
  test("every by-id route answers the guard's status with the other household's ids", async () => {
    const results: { route: string; status: number; code: string | undefined }[] = [];
    for (const probe of probes()) {
      const response = await send(probe, a.owner.cookie);
      const payload = await body<{ error?: { code: string } }>(response);
      results.push({ route: probe.label, status: response.status, code: payload.error?.code });
    }
    expect(results).toEqual(probes().map((probe) => ({ route: probe.label, status: probe.status, code: probe.code })));
  });

  test("a foreign member id is refused with memberNotInHousehold at its path", async () => {
    for (const probe of probes().filter((candidate) => candidate.status === 422)) {
      const response = await send(probe, a.owner.cookie);
      const payload = await body<{ error: { details: Array<{ path: string; i18n: { key: string } }> } }>(response);
      expect(payload.error.details.map((item) => item.i18n.key)).toEqual(["server.calendar.memberNotInHousehold"]);
      expect(payload.error.details[0]?.path).toMatch(/^(attendeeIds|assigneeIds)\.0$/);
    }
  });

  test("the refused requests changed nothing of B", async () => {
    const before = await snapshotOfB();
    for (const probe of probes()) await send(probe, a.owner.cookie);
    expect(await snapshotOfB()).toEqual(before);
    const own = await call(calendarPath(b.householdId, `/entries/${b.eventId}`), { cookie: b.owner.cookie });
    expect((await body<{ title: string }>(own)).title).toBe("Termin B");
  });

  test("A's lists never show B's rows", async () => {
    const occurrences = await body<{ items: Array<{ entryId: string }> }>(
      await call(calendarPath(a.householdId, `/occurrences?from=${DATE}&to=${DATE}`), { cookie: a.owner.cookie }),
    );
    const bIds = [b.eventId, b.taskId, b.bookingId];
    expect(occurrences.items.length).toBeGreaterThan(0);
    expect(occurrences.items.filter((item) => bIds.includes(item.entryId))).toEqual([]);
    const entries = await body<{ items: Array<{ id: string }> }>(
      await call(calendarPath(a.householdId, "/entries"), { cookie: a.owner.cookie }),
    );
    expect(entries.items.filter((item) => bIds.includes(item.id))).toEqual([]);
    const cars = await body<{ items: Array<{ id: string }> }>(
      await call(calendarPath(a.householdId, "/resources?includeArchived=true"), { cookie: a.owner.cookie }),
    );
    expect(cars.items.map((item) => item.id)).toEqual([a.carId]);
  });

  test("B's own household path refuses A's cookie before any id is read (403)", async () => {
    const response = await call(calendarPath(b.householdId, `/entries/${b.eventId}`), { cookie: a.owner.cookie });
    expect(response.status).toBe(403);
  });

  test("a foreign cookie gets the same answer from the other side (B addressing A's ids)", async () => {
    const response = await call(calendarPath(b.householdId, `/entries/${a.eventId}`), { cookie: b.owner.cookie });
    expect(response.status).toBe(404);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("not_found");
  });

  test("covers every declared :param endpoint of entries.api.ts, occurrences.api.ts and resources.api.ts", async () => {
    const routesDir = join(import.meta.dir, "..", "src", "modules", "calendar", "routes");
    const declared: string[] = [];
    for (const name of ["entries.api.ts", "occurrences.api.ts", "resources.api.ts"]) {
      const text = await readFile(join(routesDir, name), "utf8");
      const prefix = /\.prefix\("([^"]+)"\)/.exec(text)?.[1] ?? "";
      for (const match of text.matchAll(/HttpApiEndpoint\.(get|post|put|patch|delete)\(\s*"[^"]+",\s*"([^"]+)"/g)) {
        const path = `${prefix}${match[2] === "/" ? "" : (match[2] ?? "")}`;
        declared.push(`${(match[1] ?? "").toUpperCase()} ${path}`);
      }
    }
    const byId = declared.filter((route) => route.includes(":"));
    const all = probes();
    const swept = (route: string): boolean => {
      const [method, pattern] = route.split(" ") as [string, string];
      const shape = new RegExp(`^${pattern.replace(/:[A-Za-z]+/g, "[^/?]+").replace(/\//g, "\\/")}$`);
      return all.some((probe) => probe.method === method && shape.test(probe.path.split("?")[0]!));
    };
    expect(byId.filter((route) => !swept(route))).toEqual([]);
    // entry x3, occurrence state x1, car x2; and the scan saw the three files.
    expect(byId.length).toBe(6);
    expect(declared.length).toBe(11);
  });
});
