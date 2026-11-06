/**
 * `CalendarMembers` (plan m8 P9a, P6, P27): the household's members in join order with their colour and account
 * flag, and the member check of a request. On the app runtime over the shared db (`runTest`), households built
 * through the real core routes.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { householdMembers } from "../src/db/schema.ts";
import { CalendarMembers } from "../src/modules/calendar/services/members.ts";
import { addMember, addPlaceholder, createCalendarHousehold, createUser } from "./support/calendar-harness.ts";
import { runTest } from "./support/effect.ts";

beforeAll(async () => {
  await runTest(migrateDatabase());
});

/** Pins the join time of one membership (the core stamps `created_at` from the wall clock). */
async function joinedAt(householdId: string, userId: string, createdAt: number): Promise<void> {
  const rows = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
  const row = rows.find((candidate) => candidate.userId === userId);
  if (row === undefined) throw new Error("no membership");
  await db.update(householdMembers).set({ createdAt }).where(eq(householdMembers.id, row.id));
}

describe("CalendarMembers.list", () => {
  test("every member in join order, colours 1-6 cycling, placeholders without an account", async () => {
    const owner = await createUser("Eric");
    const householdId = await createCalendarHousehold(owner, "Familie");
    const robin = await createUser("Robin");
    await addMember(owner, householdId, robin);
    const kim = await addPlaceholder(owner, householdId, "Kim");
    const extra = [];
    for (const name of ["A", "B", "C", "D"]) {
      const user = await createUser(name);
      await addMember(owner, householdId, user);
      extra.push(user);
    }
    const order = [owner.id, robin.id, kim, ...extra.map((user) => user.id)];
    for (const [index, userId] of order.entries()) await joinedAt(householdId, userId, 1_000 + index);

    const members = await runTest(CalendarMembers.use((service) => service.list(householdId)));
    expect(members.map((member) => member.userId)).toEqual(order);
    expect(members.map((member) => member.colorIndex)).toEqual([1, 2, 3, 4, 5, 6, 1]);
    expect(members.map((member) => member.name).slice(0, 3)).toEqual(["Eric", "Robin", "Kim"]);
    expect(members.map((member) => member.hasAccount)).toEqual([true, true, false, true, true, true, true]);
  });

  test("equal join times are ordered by user id", async () => {
    const owner = await createUser("Owner");
    const householdId = await createCalendarHousehold(owner, "Gleichzeitig");
    const other = await createUser("Other");
    await addMember(owner, householdId, other);
    await joinedAt(householdId, owner.id, 5);
    await joinedAt(householdId, other.id, 5);
    const members = await runTest(CalendarMembers.use((service) => service.list(householdId)));
    expect(members.map((member) => member.userId)).toEqual([owner.id, other.id].sort());
  });

  test("another household's members are not listed", async () => {
    const a = await createUser("A");
    const b = await createUser("B");
    const householdA = await createCalendarHousehold(a, "A");
    await createCalendarHousehold(b, "B");
    const members = await runTest(CalendarMembers.use((service) => service.list(householdA)));
    expect(members.map((member) => member.userId)).toEqual([a.id]);
  });
});

describe("CalendarMembers.assertMembers", () => {
  test("members pass; an empty list passes", async () => {
    const owner = await createUser("Owner");
    const householdId = await createCalendarHousehold(owner, "Familie");
    const placeholder = await addPlaceholder(owner, householdId, "Kim");
    await runTest(CalendarMembers.use((service) => service.assertMembers(householdId, [owner.id, placeholder], "attendeeIds")));
    await runTest(CalendarMembers.use((service) => service.assertMembers(householdId, [], "attendeeIds")));
  });

  test("a non-member is 422 validation_failed at <path>.<index> with memberNotInHousehold, every one listed", async () => {
    const owner = await createUser("Owner");
    const stranger = await createUser("Stranger");
    const householdId = await createCalendarHousehold(owner, "Familie");
    const error = await runTest(
      Effect.flip(
        CalendarMembers.use((service) =>
          service.assertMembers(householdId, [owner.id, stranger.id, "00000000-0000-4000-8000-000000000000"], "assigneeIds"),
        ),
      ),
    );
    expect(error._tag).toBe("ValidationFailed");
    if (error._tag !== "ValidationFailed") return;
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual([
      {
        path: "assigneeIds.1",
        code: "custom",
        message: "Diese Person ist kein Mitglied des Haushalts.",
        i18n: { key: "server.calendar.memberNotInHousehold" },
      },
      {
        path: "assigneeIds.2",
        code: "custom",
        message: "Diese Person ist kein Mitglied des Haushalts.",
        i18n: { key: "server.calendar.memberNotInHousehold" },
      },
    ]);
  });

  test("a member of ANOTHER household is not a member of this one", async () => {
    const a = await createUser("A");
    const b = await createUser("B");
    const householdA = await createCalendarHousehold(a, "A");
    await createCalendarHousehold(b, "B");
    const error = await runTest(Effect.flip(CalendarMembers.use((service) => service.assertMembers(householdA, [b.id], "attendeeIds"))));
    expect(error._tag).toBe("ValidationFailed");
  });
});
