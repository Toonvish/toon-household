/**
 * The calendar module's skeleton (plan m8 M8-T02 step 6, ADR 0016): the manifest and its tables, the health list, and
 * the core chain in front of every calendar path (no cookie 401, a non-member 403, the module off `404
 * module_disabled`, an unknown path with the module on `404 not_found`). Through the real app on the shared db.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { migrateDatabase } from "../src/db/migrate.ts";
import { calendarModule } from "../src/modules/calendar/index.ts";
import { calendarTables } from "../src/modules/calendar/schema.ts";
import { API_MODULES } from "../src/modules/index.ts";
import { body, calendarPath, call, createCalendarHousehold, createPlainHousehold, createUser, enableCalendar } from "./support/calendar-harness.ts";
import { runTest } from "./support/effect.ts";

interface ErrorBody {
  error: { code: string; message: string };
}

beforeAll(async () => {
  await runTest(migrateDatabase());
});

describe("the calendar manifest", () => {
  test("id calendar, registered third, every table prefixed calendar_", () => {
    expect(calendarModule.id).toBe("calendar");
    expect(API_MODULES.map((module) => module.id)).toEqual(["recipe", "finance", "calendar"]);
    const names = Object.values(calendarTables).map((table) => getTableName(table)).sort();
    expect(names).toEqual([
      "calendar_entries",
      "calendar_entry_members",
      "calendar_feed_tokens",
      "calendar_occurrence_states",
      "calendar_resources",
      "calendar_waste_assignees",
      "calendar_waste_imports",
      "calendar_waste_settings",
    ]);
    expect(calendarModule.schema).toBe(calendarTables);
  });

  test("no setup hooks, no user API, the feed as its public API, no background work (design §2, M9)", () => {
    expect(calendarModule.onHouseholdCreated).toBeUndefined();
    expect(calendarModule.onEnable).toBeUndefined();
    expect(calendarModule.start).toBeUndefined();
    expect(calendarModule.shutdown).toBeUndefined();
    expect(calendarModule.userApi).toBeUndefined();
    // M9 (ADR 0017): the subscription feed is the module's one public API, GET /api/calendar/feed/:file.
    expect(calendarModule.publicApi).toBeDefined();
    expect(
      calendarModule.publicApi!.apis.flatMap((api) =>
        Object.values(api.groups).flatMap((group) =>
          Object.values((group as { endpoints: Record<string, { method: string; path: string }> }).endpoints).map(
            (endpoint) => `${endpoint.method} ${endpoint.path}`,
          ),
        ),
      ),
    ).toEqual(["GET /api/calendar/feed/:file"]);
    expect(calendarModule.uploadReferences).toBeUndefined();
    expect(calendarModule.onMemberRemoving).toBeDefined();
    expect(calendarModule.seedDemo).toBeDefined();
    expect(calendarModule.layer).toBeDefined();
  });
});

describe("the calendar in the app", () => {
  test("/api/health lists calendar among the build's modules", async () => {
    const response = await call("/api/health");
    expect(response.status).toBe(200);
    expect((await body<{ modules: string[] }>(response)).modules).toEqual(["recipe", "finance", "calendar"]);
  });

  test("a new household does not have it; enabling needs no settings and answers 200", async () => {
    const owner = await createUser("Owner");
    const householdId = await createPlainHousehold(owner, "Familie");
    const me = await body<{ households: Array<{ id: string; modules: string[] }> }>(await call("/api/auth/me", { cookie: owner.cookie }));
    expect(me.households.find((household) => household.id === householdId)?.modules).toEqual(["recipe"]);

    const enabled = await call(`/api/households/${householdId}/modules/calendar`, { method: "POST", cookie: owner.cookie });
    expect(enabled.status).toBe(200);
    expect((await body<{ household: { modules: string[] } }>(enabled)).household.modules).toEqual(["recipe", "calendar"]);
  });

  test("an unknown calendar path: 401 without a cookie, 403 for a non-member, 404 module_disabled while off, 404 not_found while on", async () => {
    const owner = await createUser("Owner");
    const stranger = await createUser("Stranger");
    const householdId = await createPlainHousehold(owner, "Familie");
    const path = calendarPath(householdId, "/nope");

    expect((await call(path)).status).toBe(401);

    const foreign = await call(path, { cookie: stranger.cookie });
    expect(foreign.status).toBe(403);

    const off = await call(path, { cookie: owner.cookie });
    expect(off.status).toBe(404);
    expect((await body<ErrorBody>(off)).error.code).toBe("module_disabled");

    await enableCalendar(owner, householdId);
    const on = await call(path, { cookie: owner.cookie });
    expect(on.status).toBe(404);
    expect((await body<ErrorBody>(on)).error.code).toBe("not_found");

    const write = await call(path, { method: "POST", cookie: owner.cookie, body: {} });
    expect(write.status).toBe(404);
    expect((await body<ErrorBody>(write)).error.code).toBe("not_found");
  });

  test("the harness builds a household with the calendar on", async () => {
    const owner = await createUser("Owner");
    const householdId = await createCalendarHousehold(owner, "WG");
    const off = await call(`/api/households/${householdId}/modules/calendar`, { method: "DELETE", cookie: owner.cookie });
    expect(off.status).toBe(204);
    const response = await call(calendarPath(householdId, "/nope"), { cookie: owner.cookie });
    expect((await body<ErrorBody>(response)).error.code).toBe("module_disabled");
  });
});
