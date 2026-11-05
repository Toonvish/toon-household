/**
 * The finance services on a database of their own (docs/EFFECT.md E7, E9; plan `docs/plans/e4-finance-services.md` P4,
 * P11): `withFinanceServices` builds the services with a local memo map over the CURRENT `Database`, so a private temp
 * file DB handed in through `Database.layerFrom(…)` is the database a service reaches, never the shared test DB, even
 * inside the app runtime whose `AppLayer` memoized its own copy.
 *
 * E4-T02 asserts it through `FinanceParticipants` and `FinanceSettings`: a participant row written on the private DB is
 * listed there and not on the shared one; a refusal of `assignParticipants` is the family's `ApiFailure` with today's
 * status, code and text; the module clock override stamps `joined_at`; `loadHouseholdRow` falls back to the deployment
 * default and `ensureFinanceSettings` writes once. The private DB is migrated with `runMigrations` as
 * `finance-file-db.test.ts` does; every test that pins the clock hands it back in `afterEach` (F gotcha 4).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { type CreatedDatabase, createDatabase, db as sharedDb } from "../src/db/client.ts";
import { Database } from "../src/db/database.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import { ApiError, ApiFailure, Conflict } from "../src/lib/errors.ts";
import { withFinanceServices } from "../src/modules/finance/layer.ts";
import { setClockForTest } from "../src/modules/finance/lib/clock.ts";
import { financeParticipants, financeSettings, financeTransactions } from "../src/modules/finance/schema.ts";
import { FinanceParticipants } from "../src/modules/finance/services/participants/participants.service.ts";
import { FinanceSettings } from "../src/modules/finance/services/settings/settings.service.ts";
import { runTest } from "./support/effect.ts";

await runMigrations(sharedDb);

const dir = mkdtempSync(join(tmpdir(), "toon-household-finance-services-local-"));
let created: CreatedDatabase;
const householdId = crypto.randomUUID();
const user1 = crypto.randomUUID();
const user2 = crypto.randomUUID();
const user3 = crypto.randomUUID();
const PINNED = Date.UTC(2026, 0, 15, 11, 0);

/** Runs a finance program on the private DB, inside the app runtime. */
function onPrivate<A, E>(
  effect: Effect.Effect<A, E, FinanceParticipants | FinanceSettings | Database>,
): Promise<A> {
  return runTest(withFinanceServices(effect).pipe(Effect.provide(Database.layerFrom(created))));
}

beforeAll(async () => {
  created = createDatabase({ url: `file:${join(dir, "local.db")}` });
  await created.ready;
  await runMigrations(created.db);

  const now = Date.now();
  for (const [id, name] of [
    [user1, "Eins"],
    [user2, "Zwei"],
    [user3, "Drei"],
  ] as const) {
    await created.db.insert(users).values({
      id,
      email: `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`,
      name,
      emailVerified: true,
      emailVerifiedAt: now,
    });
  }
  await created.db.insert(households).values({ id: householdId, name: "Lokal", createdBy: user1 });
  for (const userId of [user1, user2, user3]) {
    await created.db
      .insert(householdMembers)
      .values({ id: crypto.randomUUID(), householdId, userId, role: "member", createdAt: now });
  }
  await created.db.insert(financeParticipants).values([
    { householdId, userId: user1, memberSlot: 1, displayName: "Eins", joinedAt: now },
    { householdId, userId: user2, memberSlot: 2, displayName: "Zwei", joinedAt: now },
  ]);
});

afterAll(() => {
  created.client.close();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  setClockForTest(null);
});

describe("FinanceParticipants on a private temp DB", () => {
  test("the rows of the private DB are listed there, and the same household lists nothing on the shared DB", async () => {
    const listed = await onPrivate(FinanceParticipants.use((service) => service.listParticipants(householdId)));
    expect(listed.map((row) => [row.userId, row.memberSlot, row.displayName])).toEqual([
      [user1, 1, "Eins"],
      [user2, 2, "Zwei"],
    ]);
    expect(await onPrivate(FinanceParticipants.use((service) => service.slot1UserId(householdId)))).toBe(user1);
    expect(await onPrivate(FinanceParticipants.use((service) => service.otherMemberId(householdId, user1)))).toBe(user2);

    // The runtime's own copy reads the shared test DB, which has never heard of this household.
    const onShared = await runTest(FinanceParticipants.use((service) => service.listParticipants(householdId)));
    expect(onShared).toEqual([]);
  });

  test("assignParticipants refuses with the family's ApiFailure (422, same code and text), nothing written", async () => {
    const error = await onPrivate(
      Effect.flip(FinanceParticipants.use((service) => service.assignParticipants(householdId, [{ userId: user1, memberSlot: 1 }]))),
    );
    expect(error).toBeInstanceOf(ApiFailure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "finance_participants_required", text: "server.finance.participantsRequired" });
    const rows = await created.db.select().from(financeParticipants).where(eq(financeParticipants.householdId, householdId));
    expect(rows).toHaveLength(2);
  });

  test("a replacement stamps joined_at from the module clock, and the ledger blocks it with a Conflict", async () => {
    setClockForTest(PINNED);
    await onPrivate(
      FinanceParticipants.use((service) =>
        service.saveParticipants(householdId, [
          { userId: user1, memberSlot: 1 },
          { userId: user3, memberSlot: 2 },
        ]),
      ),
    );
    const seats = await created.db.select().from(financeParticipants).where(eq(financeParticipants.householdId, householdId));
    const incoming = seats.find((row) => row.userId === user3);
    expect(incoming).toMatchObject({ memberSlot: 2, displayName: "Drei", joinedAt: PINNED });

    await created.db.insert(financeTransactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId: user1,
      splitMode: "SPLIT_EQUAL",
      amountCents: 100,
      description: "blockiert",
      bookedAt: PINNED,
      dateSource: "exact",
      origin: "manual",
      categorySource: "manual",
      createdBy: user1,
      createdAt: PINNED,
      updatedAt: PINNED,
    });
    const blocked = await onPrivate(
      Effect.flip(
        FinanceParticipants.use((service) =>
          service.assignParticipants(householdId, [
            { userId: user1, memberSlot: 1 },
            { userId: user2, memberSlot: 2 },
          ]),
        ),
      ),
    );
    expect(blocked).toBeInstanceOf(Conflict);
    expect(blocked).toMatchObject({ status: 409, code: "finance_participant_in_use" });

    // The veto of `onMemberRemoving` on the same private executor refuses with the same family member.
    await expect(
      onPrivate(
        Effect.flip(FinanceParticipants.use((service) => service.assertParticipantMayLeave(householdId, user3))),
      ),
    ).resolves.toMatchObject({
      status: 409,
      code: "member_has_ledger",
    });
  });
});

describe("FinanceSettings on a private temp DB", () => {
  test("loadHouseholdRow falls back to the deployment default, ensureFinanceSettings writes once", async () => {
    const fallback = await onPrivate(FinanceSettings.use((service) => service.loadHouseholdRow(householdId)));
    expect(fallback.householdId).toBe(householdId);

    await onPrivate(FinanceSettings.use((service) => service.ensureFinanceSettings(householdId, "en")));
    await onPrivate(FinanceSettings.use((service) => service.ensureFinanceSettings(householdId, "de")));
    const row = await onPrivate(FinanceSettings.use((service) => service.loadHouseholdRow(householdId)));
    expect(row).toEqual({ householdId, defaultLocale: "en" });
    const stored = await created.db.select().from(financeSettings).where(eq(financeSettings.householdId, householdId));
    expect(stored).toHaveLength(1);

    const onShared = await runTest(FinanceSettings.use((service) => service.loadHouseholdRow(householdId)));
    expect(onShared.householdId).toBe(householdId);
    expect(await sharedDb.select().from(financeSettings).where(eq(financeSettings.householdId, householdId))).toEqual([]);
  });
});
