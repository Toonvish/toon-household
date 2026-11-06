/**
 * Car bookings and their conflict check (plan m8 M8-T05; P11): half-open wall-time intervals, all-day covering the
 * whole day, recurring bookings against single and recurring ones within the 366-day horizon and not beyond it,
 * skipped occurrences that block nothing, a PATCH that excludes the entry itself, and `allowConflict`. Through the
 * routes, plus the service's own answer on the app runtime.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { addCalendarDays } from "@toon/shared";
import { db } from "../src/db/client.ts";
import { CalendarCarConflicts } from "../src/modules/calendar/services/entries/conflicts.service.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { type TestUser, addMember, body, calendarPath, call, createCalendarHousehold, createUser } from "./support/calendar-harness.ts";
import { runTest } from "./support/effect.ts";

await runMigrations(db);

interface Conflict {
  entryId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string | null;
  memberIds: string[];
}

interface ErrorBody {
  error: { code: string; message: string; details?: Conflict[] };
}

let owner: TestUser;
let robin: TestUser;
let householdId = "";

beforeAll(async () => {
  owner = await createUser("Eric");
  householdId = await createCalendarHousehold(owner, "Autos");
  robin = await createUser("Robin");
  await addMember(owner, householdId, robin);
});

async function newCar(name = "Auto"): Promise<string> {
  const response = await call(calendarPath(householdId, "/resources"), { method: "POST", cookie: owner.cookie, body: { name } });
  return (await body<{ id: string }>(response)).id;
}

function booking(resourceId: string, fields: Record<string, unknown>) {
  return { kind: "car", title: "Fahrt", allDay: false, attendeeIds: [robin.id], resourceId, ...fields };
}

const post = (payload: unknown) =>
  call(calendarPath(householdId, "/entries"), { method: "POST", cookie: owner.cookie, body: payload });

async function book(payload: unknown): Promise<string> {
  const response = await post(payload);
  if (response.status !== 201) throw new Error(`booking failed: ${response.status} ${await response.text()}`);
  return (await body<{ id: string }>(response)).id;
}

/** The conflicts of a refused booking (asserting the 409), or `[]` for a 201. */
async function conflictsOf(response: Response): Promise<Conflict[]> {
  if (response.status === 201) return [];
  expect(response.status).toBe(409);
  const payload = await body<ErrorBody>(response);
  expect(payload.error.code).toBe("calendar_car_conflict");
  return payload.error.details ?? [];
}

describe("single bookings", () => {
  test("overlapping times conflict, touching ones do not; the details name who has the car when", async () => {
    const car = await newCar();
    const first = await book(booking(car, { title: "Arbeit", startDate: "2027-03-04", startTime: "08:00", endTime: "17:00" }));
    const refused = await post(booking(car, { startDate: "2027-03-04", startTime: "16:00", endTime: "18:00" }));
    const payload = await body<ErrorBody>(refused);
    expect(refused.status).toBe(409);
    expect(payload.error.code).toBe("calendar_car_conflict");
    expect(payload.error.message.length).toBeGreaterThan(0);
    expect(payload.error.details).toEqual([
      { entryId: first, date: "2027-03-04", startTime: "08:00", endTime: "17:00", title: "Arbeit", memberIds: [robin.id] },
    ]);
    expect(await conflictsOf(await post(booking(car, { startDate: "2027-03-04", startTime: "17:00", endTime: "18:00" })))).toEqual([]);
    expect(await conflictsOf(await post(booking(car, { startDate: "2027-03-04", startTime: "06:00", endTime: "08:00" })))).toEqual([]);
  });

  test("an all-day booking covers its whole days", async () => {
    const car = await newCar();
    const allDay = await book(booking(car, { allDay: true, startDate: "2027-03-10", endDate: "2027-03-12" }));
    const late = await conflictsOf(await post(booking(car, { startDate: "2027-03-12", startTime: "23:00", endTime: "23:30" })));
    expect(late.map((conflict) => [conflict.entryId, conflict.date, conflict.startTime])).toEqual([[allDay, "2027-03-10", null]]);
    expect(await conflictsOf(await post(booking(car, { startDate: "2027-03-13", startTime: "00:00", endTime: "01:00" })))).toEqual([]);
    // Overnight into the all-day block.
    const overnight = await conflictsOf(
      await post(booking(car, { startDate: "2027-03-09", endDate: "2027-03-10", startTime: "20:00", endTime: "06:00" })),
    );
    expect(overnight.map((conflict) => conflict.entryId)).toEqual([allDay]);
    // The evening before is free (a 201: every probe that passes books the car).
    expect(await conflictsOf(await post(booking(car, { startDate: "2027-03-09", startTime: "20:00", endTime: "23:59" })))).toEqual([]);
  });

  test("another car never conflicts", async () => {
    const car = await newCar();
    const other = await newCar("Zweitwagen");
    await book(booking(car, { startDate: "2027-03-15", startTime: "08:00", endTime: "17:00" }));
    expect(await conflictsOf(await post(booking(other, { startDate: "2027-03-15", startTime: "08:00", endTime: "17:00" })))).toEqual([]);
  });
});

describe("recurring bookings", () => {
  test("a weekly booking blocks a single one on its weekday only", async () => {
    const car = await newCar();
    // 2027-04-01 is a Thursday.
    const weekly = await book(
      booking(car, { startDate: "2027-04-01", startTime: "08:00", endTime: "17:00", repeat: { freq: "weekly" } }),
    );
    const thursday = await conflictsOf(await post(booking(car, { startDate: "2027-06-10", startTime: "09:00", endTime: "10:00" })));
    expect(thursday.map((conflict) => [conflict.entryId, conflict.date])).toEqual([[weekly, "2027-06-10"]]);
    expect(await conflictsOf(await post(booking(car, { startDate: "2027-06-11", startTime: "09:00", endTime: "10:00" })))).toEqual([]);
  });

  test("recurring against recurring lists at most ten conflicts, by date", async () => {
    const car = await newCar();
    const weekly = await book(
      booking(car, { startDate: "2027-04-01", startTime: "08:00", endTime: "17:00", repeat: { freq: "weekly" } }),
    );
    const daily = await conflictsOf(
      await post(booking(car, { startDate: "2027-04-02", startTime: "07:00", endTime: "09:00", repeat: { freq: "daily" } })),
    );
    expect(daily.length).toBe(10);
    expect(daily[0]).toMatchObject({ entryId: weekly, date: "2027-04-08" });
    expect(daily.map((conflict) => conflict.date)).toEqual(
      Array.from({ length: 10 }, (_, index) => addCalendarDays("2027-04-08", index * 7)),
    );
    // The weekly series ends before the daily one starts: no conflict.
    const ended = await newCar();
    await book(
      booking(ended, {
        startDate: "2027-04-01",
        startTime: "08:00",
        endTime: "17:00",
        repeat: { freq: "weekly", until: "2027-04-29" },
      }),
    );
    expect(
      await conflictsOf(
        await post(booking(ended, { startDate: "2027-04-30", startTime: "07:00", endTime: "09:00", repeat: { freq: "daily" } })),
      ),
    ).toEqual([]);
  });

  test("the check looks 366 days ahead of a recurring booking, not further", async () => {
    const car = await newCar();
    const start = "2027-04-01";
    const far = addCalendarDays(start, 371); // a Thursday 53 weeks later, beyond the horizon
    await book(booking(car, { startDate: far, startTime: "08:00", endTime: "09:00" }));
    const nearDate = addCalendarDays(start, 364); // inside the horizon
    const near = await book(booking(car, { startDate: nearDate, startTime: "08:00", endTime: "09:00" }));
    const found = await conflictsOf(
      await post(booking(car, { startDate: start, startTime: "08:30", endTime: "10:00", repeat: { freq: "weekly" } })),
    );
    expect(found.map((conflict) => [conflict.entryId, conflict.date])).toEqual([[near, nearDate]]);
  });

  test("a skipped occurrence blocks nothing", async () => {
    const car = await newCar();
    const weekly = await book(
      booking(car, { startDate: "2027-04-01", startTime: "08:00", endTime: "17:00", repeat: { freq: "weekly" } }),
    );
    const skip = await call(calendarPath(householdId, `/entries/${weekly}/occurrences/2027-04-15`), {
      method: "PUT",
      cookie: owner.cookie,
      body: { status: "skipped" },
    });
    expect(skip.status).toBe(200);
    expect(await conflictsOf(await post(booking(car, { startDate: "2027-04-15", startTime: "09:00", endTime: "10:00" })))).toEqual([]);
    expect((await conflictsOf(await post(booking(car, { startDate: "2027-04-22", startTime: "09:00", endTime: "10:00" })))).length).toBe(1);
  });
});

describe("the client's today anchors a recurring booking's horizon", () => {
  const patch = (id: string, payload: unknown) =>
    call(calendarPath(householdId, `/entries/${id}`), { method: "PATCH", cookie: owner.cookie, body: payload });

  test("editing a series that started over a year ago is checked against the coming year", async () => {
    const car = await newCar();
    // 2025-01-02 is a Thursday; the series runs on, and today is 2026-11-06.
    const series = await book(
      booking(car, { startDate: "2025-01-02", startTime: "10:00", endTime: "11:00", repeat: { freq: "weekly" } }),
    );
    // A single booking on a Thursday after today, 07:00-09:00: no overlap with 10:00-11:00.
    const single = await book(booking(car, { startDate: "2026-11-12", startTime: "07:00", endTime: "09:00" }));
    const longer = { startTime: "07:00", endTime: "18:00" };
    // With the client's today the window starts there, so the coming Thursday is found.
    const refused = await patch(series, { ...longer, today: "2026-11-06" });
    expect(refused.status).toBe(409);
    const conflicts = (await body<ErrorBody>(refused)).error.details ?? [];
    expect(conflicts.map((conflict) => [conflict.entryId, conflict.date])).toEqual([[single, "2026-11-12"]]);
    // Without it (an older client) the window is the series start's year, which lies in the past.
    expect((await patch(series, longer)).status).toBe(200);
  });

  test("a new recurring booking that starts in the past is checked from today", async () => {
    const car = await newCar();
    const single = await book(booking(car, { startDate: "2026-11-12", startTime: "07:00", endTime: "09:00" }));
    const old = booking(car, { startDate: "2025-01-02", startTime: "08:00", endTime: "12:00", repeat: { freq: "weekly" } });
    const found = await conflictsOf(await post({ ...old, today: "2026-11-06" }));
    expect(found.map((conflict) => [conflict.entryId, conflict.date])).toEqual([[single, "2026-11-12"]]);
  });

  test("a series that ended before today has nothing left to check; a single booking ignores today", async () => {
    const car = await newCar();
    await book(booking(car, { startDate: "2026-03-05", startTime: "08:00", endTime: "12:00" }));
    const ended = booking(car, {
      startDate: "2026-01-01",
      startTime: "07:00",
      endTime: "09:00",
      repeat: { freq: "weekly", until: "2026-04-30" },
    });
    // The past series overlaps the 2026-03-05 booking, but nothing of it is left after today.
    expect(await conflictsOf(await post({ ...ended, today: "2026-11-06" }))).toEqual([]);
    // A single booking in the past is still checked over its own day.
    const past = await conflictsOf(
      await post(booking(car, { startDate: "2026-03-05", startTime: "09:00", endTime: "10:00", today: "2026-11-06" })),
    );
    expect(past.length).toBe(1);
  });
});

describe("PATCH and allowConflict", () => {
  test("a PATCH never conflicts with itself, but with the others; a note change is no new check", async () => {
    const car = await newCar();
    const first = await book(booking(car, { startDate: "2027-05-03", startTime: "08:00", endTime: "12:00" }));
    const second = await book(booking(car, { startDate: "2027-05-03", startTime: "13:00", endTime: "15:00" }));
    const patch = (id: string, payload: unknown) =>
      call(calendarPath(householdId, `/entries/${id}`), { method: "PATCH", cookie: owner.cookie, body: payload });
    expect((await patch(first, { endTime: "12:30" })).status).toBe(200);
    const moved = await patch(second, { startTime: "11:00" });
    expect(moved.status).toBe(409);
    expect((await body<ErrorBody>(moved)).error.details?.map((conflict) => conflict.entryId)).toEqual([first]);
    expect((await patch(second, { startTime: "11:00", allowConflict: true })).status).toBe(200);
    // Both overlap now; editing a note of either is not refused.
    expect((await patch(first, { notes: "Tank voll" })).status).toBe(200);
    // Moving to another car of this household is checked against that car's bookings.
    const other = await newCar("Leihwagen");
    expect((await patch(first, { resourceId: other })).status).toBe(200);
  });

  test("allowConflict books anyway", async () => {
    const car = await newCar();
    await book(booking(car, { startDate: "2027-05-10", startTime: "08:00", endTime: "12:00" }));
    const response = await post(booking(car, { startDate: "2027-05-10", startTime: "09:00", endTime: "10:00", allowConflict: true }));
    expect(response.status).toBe(201);
  });

  test("the service answers the conflicts; it refuses nothing itself", async () => {
    const car = await newCar();
    const first = await book(booking(car, { startDate: "2027-05-20", startTime: "08:00", endTime: "12:00" }));
    const found = await runTest(
      CalendarCarConflicts.use((service) =>
        service.check(
          householdId,
          {
            resourceId: car,
            allDay: true,
            startDate: "2027-05-20",
            startTime: null,
            endDate: "2027-05-20",
            endTime: null,
            repeat: { freq: "none", interval: 1, weekdays: [], until: null },
          },
          null,
          null,
        ),
      ),
    );
    expect(found.map((conflict) => conflict.entryId)).toEqual([first]);
    const self = await runTest(
      CalendarCarConflicts.use((service) =>
        service.check(
          householdId,
          {
            resourceId: car,
            allDay: false,
            startDate: "2027-05-20",
            startTime: "09:00",
            endDate: "2027-05-20",
            endTime: "10:00",
            repeat: { freq: "none", interval: 1, weekdays: [], until: null },
          },
          first,
          null,
        ),
      ),
    );
    expect(self).toEqual([]);
  });
});
