/**
 * `CalendarResources` through the routes (plan m8 M8-T05, M8-T06; P13): create, the list with and without archived
 * cars, rename, archive (`archivedAt` from the Clock) and restore, the delete refusal while a booking references the
 * car, and the name rules.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { db } from "../src/db/client.ts";
import { CalendarResources } from "../src/modules/calendar/services/entries/resources.service.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { type TestUser, body, calendarPath, call, createCalendarHousehold, createUser } from "./support/calendar-harness.ts";
import { runTest } from "./support/effect.ts";

await runMigrations(db);

interface Resource {
  id: string;
  kind: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
}

interface ErrorBody {
  error: { code: string; details?: Array<{ path: string; i18n: { key: string } }> };
}

let owner: TestUser;
let householdId = "";

const send = (method: string, path: string, payload?: unknown) =>
  call(calendarPath(householdId, path), { method, cookie: owner.cookie, body: payload });

async function names(query = ""): Promise<string[]> {
  return (await body<{ items: Resource[] }>(await send("GET", `/resources${query}`))).items.map((item) => item.name);
}

beforeAll(async () => {
  owner = await createUser("Eric");
  householdId = await createCalendarHousehold(owner, "Fuhrpark");
});

describe("cars", () => {
  test("create answers 201 with the car; the list is by name", async () => {
    const response = await send("POST", "/resources", { name: "  VW Golf " });
    expect(response.status).toBe(201);
    const golf = await body<Resource>(response);
    expect(golf).toMatchObject({ kind: "car", name: "VW Golf", archived: false, archivedAt: null });
    expect(Number.isNaN(Date.parse(golf.createdAt))).toBe(false);
    await send("POST", "/resources", { name: "Familienauto" });
    expect(await names()).toEqual(["Familienauto", "VW Golf"]);
  });

  test("names are 1-60 characters without control characters", async () => {
    for (const name of ["", "   ", "x".repeat(61), "Auto\nZwei"]) {
      const response = await send("POST", "/resources", { name });
      expect([name, response.status]).toEqual([name, 422]);
      const payload = await body<ErrorBody>(response);
      expect(payload.error.details?.[0]?.path).toBe("name");
    }
    expect((await send("POST", "/resources", { name: "x".repeat(60) })).status).toBe(201);
  });

  test("rename, archive (hidden unless asked for), restore", async () => {
    const car = await body<Resource>(await send("POST", "/resources", { name: "Alter Polo" }));
    const renamed = await body<Resource>(await send("PATCH", `/resources/${car.id}`, { name: "Polo" }));
    expect(renamed).toMatchObject({ id: car.id, name: "Polo", archived: false });
    const archived = await body<Resource>(await send("PATCH", `/resources/${car.id}`, { archived: true }));
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).not.toBeNull();
    expect(await names()).not.toContain("Polo");
    expect(await names("?includeArchived=true")).toContain("Polo");
    expect(await names("?includeArchived=false")).not.toContain("Polo");
    // Archiving again keeps the first stamp.
    const again = await body<Resource>(await send("PATCH", `/resources/${car.id}`, { archived: true }));
    expect(again.archivedAt).toBe(archived.archivedAt);
    const restored = await body<Resource>(await send("PATCH", `/resources/${car.id}`, { archived: false }));
    expect(restored).toMatchObject({ archived: false, archivedAt: null });
    expect(await names()).toContain("Polo");
    expect((await send("GET", "/resources?includeArchived=yes")).status).toBe(422);
  });

  test("delete: 204 for an unbooked car, 409 calendar_resource_in_use while a booking references it", async () => {
    const spare = await body<Resource>(await send("POST", "/resources", { name: "Ersatz" }));
    expect((await send("DELETE", `/resources/${spare.id}`)).status).toBe(204);
    expect(await names("?includeArchived=true")).not.toContain("Ersatz");
    expect((await send("DELETE", `/resources/${spare.id}`)).status).toBe(404);

    const booked = await body<Resource>(await send("POST", "/resources", { name: "Gebucht" }));
    const entry = await send("POST", "/entries", {
      kind: "car",
      title: "Einkauf",
      allDay: true,
      startDate: "2027-02-01",
      attendeeIds: [owner.id],
      resourceId: booked.id,
    });
    expect(entry.status).toBe(201);
    const refused = await send("DELETE", `/resources/${booked.id}`);
    expect(refused.status).toBe(409);
    expect((await body<ErrorBody>(refused)).error.code).toBe("calendar_resource_in_use");
    // Archiving is the way out; the booking keeps its car.
    expect((await send("PATCH", `/resources/${booked.id}`, { archived: true })).status).toBe(200);
    const entryId = (await body<{ id: string }>(entry)).id;
    expect((await body<{ resourceId: string }>(await send("GET", `/entries/${entryId}`))).resourceId).toBe(booked.id);
    // Editing the booking's notes is fine while its car is archived; a NEW booking of it is not.
    expect((await send("PATCH", `/entries/${entryId}`, { notes: "Kofferraum" })).status).toBe(200);
  });

  test("an unknown car is 404 on PATCH and DELETE", async () => {
    const id = crypto.randomUUID();
    expect((await send("PATCH", `/resources/${id}`, { name: "x" })).status).toBe(404);
    expect((await send("DELETE", `/resources/${id}`)).status).toBe(404);
  });
});

describe("the Clock stamps", () => {
  test("createdAt and archivedAt come from the Clock", async () => {
    const at = Date.UTC(2027, 0, 2, 3, 4, 5);
    const stamps = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(at);
        const resources = yield* CalendarResources;
        const car = yield* resources.create(householdId, { name: "Uhrzeit" });
        yield* TestClock.adjust("1 hour");
        const archived = yield* resources.update(householdId, car.id, { archived: true });
        return [car.createdAt, archived.archivedAt];
      }),
      { clock: "test" },
    );
    expect(stamps).toEqual(["2027-01-02T03:04:05.000Z", "2027-01-02T04:04:05.000Z"]);
  });
});
