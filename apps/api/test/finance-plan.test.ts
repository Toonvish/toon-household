/**
 * Integration tests for /api/households/:householdId/finance/plan: `plan_incomplete`
 * before the plan has data, the income-proportional share (cross-checked
 * against the `Haushalt.xlsx`-derived numbers, ledger-spec.md §4.2), the
 * monthly run's idempotency (running twice books nothing twice), catching up
 * on missed months, and the recalculate preview/apply/re-apply-is-a-no-op
 * flow. Every clock-dependent assertion pins "now" via `setClockForTest` and
 * restores it in `afterEach` (CLAUDE.md's `mock.module` gotcha: an explicit
 * setter seam, not a module mock).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { financeTransactions as transactions } from "../src/modules/finance/schema.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { setClockForTest } from "../src/modules/finance/lib/clock.ts";
import { body, call, createHousehold, createUser, joinAsSecondMember, type TestUser } from "./support/finance-harness.ts";

await runMigrations(db);

afterEach(() => setClockForTest(null));

interface ErrorPayload {
  error: { code: string; message: string };
}
interface PlanResponse {
  plan: { enabled: boolean; payerId: string; startPeriod: string; lastBookedPeriod: string | null };
  items: { id: string }[];
  incomes: { id: string; personId: string }[];
  current: { bookableCents: number; costTotalCents: number; incomeTotalCents: number; booked: boolean } | null;
  pendingPeriods: string[];
}
interface RunPlanResponse {
  bookedPeriods: string[];
  skippedPeriods: string[];
  bookedCents: number;
}
interface RecalculatePlanResponse {
  items: { period: string; bookedCents: number; recomputedCents: number; deltaCents: number }[];
  totalDeltaCents: number;
  applied: boolean;
  adjustments: { id: string; origin: string; externalKey?: string }[];
}

const JAN = Date.UTC(2026, 0, 15, 12); // 2026-01, well inside the month in every timezone
const FEB = Date.UTC(2026, 1, 15, 12);
const APR = Date.UTC(2026, 3, 15, 12);

/** Seeds one fixed-cost item + both incomes reproducing the exact Haushalt.xlsx numbers (ledger-spec.md §4.2). */
async function seedFullPlan(owner: TestUser, partner: TestUser, householdId: string): Promise<void> {
  await call(`/api/households/${householdId}/finance/plan/items`, {
    method: "POST",
    cookie: owner.cookie,
    body: { label: "Fixkosten Gesamt", amountCents: 118_750, activeFrom: "2026-01" },
  });
  await call(`/api/households/${householdId}/finance/plan/incomes`, {
    method: "POST",
    cookie: owner.cookie,
    body: { personId: owner.id, amountCents: 301_745, validFrom: "2026-01" },
  });
  await call(`/api/households/${householdId}/finance/plan/incomes`, {
    method: "POST",
    cookie: owner.cookie,
    body: { personId: partner.id, amountCents: 198_255, validFrom: "2026-01" },
  });
  const enabled = await call(`/api/households/${householdId}/finance/plan`, { method: "PATCH", cookie: owner.cookie, body: { enabled: true } });
  expect(enabled.status).toBe(200);
}

describe("plan_incomplete", () => {
  test("GET /plan/preview 409s before any items/incomes exist", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Unvollständig");

    const preview = await call(`/api/households/${householdId}/finance/plan/preview?period=2026-01`, { cookie: owner.cookie });
    expect(preview.status).toBe(409);
    expect((await body<ErrorPayload>(preview)).error.code).toBe("plan_incomplete");
  });

  test("POST /plan/run 409s while the plan is disabled", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Deaktiviert");
    const run = await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} });
    expect(run.status).toBe(409);
    expect((await body<ErrorPayload>(run)).error.code).toBe("plan_disabled");
  });
});

describe("income rows", () => {
  test("a second income row with the same validFrom is 409 conflict, not a 500", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Doppeltes Gehalt");

    const payload = { personId: owner.id, amountCents: 300_000, validFrom: "2026-01" };
    const first = await call(`/api/households/${householdId}/finance/plan/incomes`, { method: "POST", cookie: owner.cookie, body: payload });
    expect(first.status).toBe(201);

    // `incomes_person_from_uidx` rejects this. The service catches it and is
    // supposed to answer 409 — which only works if `isUniqueViolation` looks
    // inside the `DrizzleQueryError` wrapper (see households.test.ts).
    const second = await call(`/api/households/${householdId}/finance/plan/incomes`, { method: "POST", cookie: owner.cookie, body: payload });
    expect(second.status).toBe(409);
    expect((await body<ErrorPayload>(second)).error.code).toBe("conflict");
  });
});

describe("the income-proportional share", () => {
  test("matches the Haushalt.xlsx-derived figures exactly", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Anteil");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId);

    const plan = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    expect(plan.current?.costTotalCents).toBe(118_750);
    expect(plan.current?.incomeTotalCents).toBe(500_000);
    expect(plan.current?.bookableCents).toBe(47_086); // = ledger-spec.md's "share(P2)"
  });
});

describe("the monthly run — booking, idempotency, catch-up", () => {
  test("books the current period once; running again books nothing new", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Einmal buchen");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId);

    const firstRun = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    expect(firstRun.bookedPeriods).toEqual(["2026-01"]);
    expect(firstRun.bookedCents).toBe(47_086);

    const secondRun = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    expect(secondRun.bookedPeriods).toEqual([]);

    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalKey).toBe(`fixedplan:${householdId}:2026-01`);
    expect(rows[0]?.amountCents).toBe(47_086);
    expect(rows[0]?.payerId).toBe(owner.id); // OTHER_ONLY, booked FOR the non-payer (partner)
    expect(rows[0]?.splitMode).toBe("OTHER_ONLY");
  });

  test("a container that slept through several months catches up in one run", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Nachholen");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId);

    await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }); // books 2026-01

    setClockForTest(APR); // three months slept through
    const catchUp = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    expect(catchUp.bookedPeriods).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(catchUp.bookedCents).toBe(47_086 * 3);

    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan")));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.planPeriod).sort()).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);

    const plan = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    expect(plan.plan.lastBookedPeriod).toBe("2026-04");
    expect(plan.pendingPeriods).toEqual([]);

    // The catch-up never re-books what running the loop again would find already done.
    const again = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    expect(again.bookedPeriods).toEqual([]);
    const rowsAfter = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan")));
    expect(rowsAfter).toHaveLength(4);
  });

  test("never books the future: `through` is clamped to the current period", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Nicht die Zukunft");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId);

    const run = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: { through: "2026-12" } }),
    );
    expect(run.bookedPeriods).toEqual(["2026-01"]);
  });

  test("a period skipped for missing data is never permanently lost, once the data is backfilled (review finding #2)", async () => {
    setClockForTest(JAN); // household startPeriod = 2026-01
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Lücke");
    await joinAsSecondMember(owner, householdId, partner);

    // Items/incomes exist only from 2026-03 on — 2026-01/02 are a genuine data gap.
    await call(`/api/households/${householdId}/finance/plan/items`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Fixkosten Gesamt", amountCents: 118_750, activeFrom: "2026-03" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: owner.id, amountCents: 301_745, validFrom: "2026-03" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: partner.id, amountCents: 198_255, validFrom: "2026-03" },
    });
    await call(`/api/households/${householdId}/finance/plan`, { method: "PATCH", cookie: owner.cookie, body: { enabled: true } });

    setClockForTest(APR);
    const firstRun = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    expect(firstRun.bookedPeriods).toEqual(["2026-03", "2026-04"]);
    expect(firstRun.skippedPeriods).toEqual(["2026-01", "2026-02"]);

    // The gap must stay visible — `lastBookedPeriod` must NOT have jumped past it.
    const afterFirstRun = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    expect(afterFirstRun.plan.lastBookedPeriod).not.toBe("2026-04");
    expect(afterFirstRun.pendingPeriods).toContain("2026-01");
    expect(afterFirstRun.pendingPeriods).toContain("2026-02");

    // The user backfills the missing two months (a non-overlapping item/income pair).
    await call(`/api/households/${householdId}/finance/plan/items`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Fixkosten Gesamt (nachgetragen)", amountCents: 118_750, activeFrom: "2026-01", activeTo: "2026-02" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: owner.id, amountCents: 301_745, validFrom: "2026-01", validTo: "2026-02" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: partner.id, amountCents: 198_255, validFrom: "2026-01", validTo: "2026-02" },
    });

    const secondRun = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    // The previously-lost months are booked now that the data exists — NOT lost forever.
    expect(secondRun.bookedPeriods).toEqual(["2026-01", "2026-02"]);
    expect(secondRun.bookedCents).toBe(47_086 * 2);

    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan")));
    expect(rows.map((r) => r.planPeriod).sort()).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });
});

describe("import/plan period collision (review finding #3/#4, docs/spec.md §7.4 test #55)", () => {
  test("imported rent and the live plan never collide", async () => {
    // The household is created (and its plan defaults `startPeriod` to the
    // CURRENT period, households.service.ts:76) BEFORE the import ever runs —
    // exactly the ordering docs/ledger-spec.md §4.7 and the review finding
    // describe: any household seeded before the one-time xlsx import starts
    // out with a `startPeriod` that already overlaps the imported rent range,
    // with no PATCH involved at all.
    const JUL = Date.UTC(2026, 6, 15, 12);
    setClockForTest(JUL);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Import Kollision");
    await joinAsSecondMember(owner, householdId, partner);

    // Simulate exactly what scripts/finance-import-xlsx.ts writes for the rent series.
    const importId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(transactions).values({
      id: importId,
      householdId,
      payerId: owner.id,
      splitMode: "OTHER_ONLY",
      amountCents: 47_086,
      description: "Fixkostenanteil 07/2026",
      categoryId: null,
      bookedAt: now,
      dateSource: "month",
      origin: "import",
      planPeriod: "2026-07",
      categorySource: "system",
      importSeq: null,
      externalKey: "xlsx:rent:2026-07",
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });

    await call(`/api/households/${householdId}/finance/plan/items`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Fixkosten Gesamt", amountCents: 118_750, activeFrom: "2026-01" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: owner.id, amountCents: 301_745, validFrom: "2026-01" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: partner.id, amountCents: 198_255, validFrom: "2026-01" },
    });
    // No `startPeriod` in this PATCH — the plan already defaulted to 2026-07 at creation.
    await call(`/api/households/${householdId}/finance/plan`, { method: "PATCH", cookie: owner.cookie, body: { enabled: true } });

    const plan = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    expect(plan.current?.booked).toBe(true); // already covered by the import, even though no fixed_plan row exists yet

    const run = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    expect(run.bookedPeriods).toEqual([]);
    expect(run.skippedPeriods).toEqual(["2026-07"]);
    expect(run.bookedCents).toBe(0);

    const rows = await db.select().from(transactions).where(and(eq(transactions.householdId, householdId), eq(transactions.planPeriod, "2026-07")));
    expect(rows).toHaveLength(1); // still just the imported row — NOT doubled
    expect(rows[0]?.origin).toBe("import");

    const balance = await body<{ balanceCents: number }>(await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie }));
    expect(balance.balanceCents).toBe(47_086); // not 97 246
  });

  test("PATCH /plan rejects a startPeriod that would overlap an already-occupied period", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Startperiode gesperrt");

    const now = Date.now();
    await db.insert(transactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId: owner.id,
      splitMode: "OTHER_ONLY",
      amountCents: 47_086,
      description: "Fixkostenanteil 07/2026",
      categoryId: null,
      bookedAt: now,
      dateSource: "month",
      origin: "import",
      planPeriod: "2026-07",
      categorySource: "system",
      importSeq: null,
      externalKey: "xlsx:rent:2026-07",
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });

    const onto = await call(`/api/households/${householdId}/finance/plan`, { method: "PATCH", cookie: owner.cookie, body: { startPeriod: "2026-07" } });
    expect(onto.status).toBe(409);
    expect((await body<ErrorPayload>(onto)).error.code).toBe("plan_period_locked");

    const before = await call(`/api/households/${householdId}/finance/plan`, { method: "PATCH", cookie: owner.cookie, body: { startPeriod: "2026-06" } });
    expect(before.status).toBe(409);

    const after = await call(`/api/households/${householdId}/finance/plan`, { method: "PATCH", cookie: owner.cookie, body: { startPeriod: "2026-08" } });
    expect(after.status).toBe(200);
  });
});

describe("recalculate — booked periods are never edited", () => {
  test("preview shows the delta; apply books an adjustment; re-applying is a no-op", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Neuberechnung");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId);
    await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }); // books 2026-01 at 47 086

    // A retroactive raise for the payer (owner) does not touch the booked row...
    const plan = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    const ownerIncome = plan.incomes.find((i) => i.personId === owner.id)!;
    await call(`/api/households/${householdId}/finance/plan/incomes/${ownerIncome.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { amountCents: 400_000 },
    });

    const preview = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: true } }),
    );
    expect(preview.applied).toBe(false);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]?.period).toBe("2026-01");
    expect(preview.items[0]?.bookedCents).toBe(47_086);
    const expectedRecomputed = preview.items[0]!.recomputedCents;
    expect(preview.items[0]?.deltaCents).toBe(expectedRecomputed - 47_086);

    // ...instead it books a NEW adjustment transaction alongside it.
    const apply = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(apply.applied).toBe(true);
    expect(apply.adjustments).toHaveLength(1);
    expect(apply.adjustments[0]?.origin).toBe("fixed_plan_adjustment");

    const bookedRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan")));
    expect(bookedRows).toHaveLength(1);
    expect(bookedRows[0]?.amountCents).toBe(47_086); // untouched

    const adjustmentRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan_adjustment")));
    expect(adjustmentRows).toHaveLength(1);
    expect(adjustmentRows[0]?.externalKey).toBe(`fixedplan-adj:${householdId}:2026-01:47086`);

    // Re-applying against the SAME (unchanged since the raise) data now diffs against the
    // EFFECTIVE booked amount (original + the adjustment just written), which is exactly what
    // today's data recomputes to — so there is nothing left to preview or apply at all
    // (review finding #1: diffing against the untouched ORIGINAL amount would instead find the
    // same stale delta every time and collide on the same externalKey forever).
    const reapply = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(reapply.applied).toBe(false);
    expect(reapply.items).toHaveLength(0);
    expect(reapply.adjustments).toHaveLength(0);
    const adjustmentRowsAfter = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan_adjustment")));
    expect(adjustmentRowsAfter).toHaveLength(1);
  });

  test("a SECOND retroactive correction of the same period books a second, distinct adjustment (review finding #1)", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Zweite Korrektur");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId); // owner income 301 745, booked 2026-01 at 47 086
    await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} });

    const plan = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    const ownerIncome = plan.incomes.find((i) => i.personId === owner.id)!;

    // First correction: 301 745 -> 400 000.
    await call(`/api/households/${householdId}/finance/plan/incomes/${ownerIncome.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { amountCents: 400_000 },
    });
    const firstApply = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(firstApply.adjustments).toHaveLength(1);
    const firstDelta = firstApply.items[0]!.deltaCents;
    const effectiveAfterFirst = 47_086 + firstDelta;

    // Second correction: 400 000 -> 500 000. Must NOT collide with the first adjustment's externalKey.
    await call(`/api/households/${householdId}/finance/plan/incomes/${ownerIncome.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { amountCents: 500_000 },
    });
    const secondPreview = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: true } }),
    );
    expect(secondPreview.items).toHaveLength(1);
    expect(secondPreview.items[0]?.bookedCents).toBe(effectiveAfterFirst); // diffs against the EFFECTIVE amount, not the original 47 086

    const secondApply = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(secondApply.applied).toBe(true);
    expect(secondApply.adjustments).toHaveLength(1); // NOT [] — the bug this test guards against

    const adjustmentRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan_adjustment")));
    expect(adjustmentRows).toHaveLength(2);
    const externalKeys = adjustmentRows.map((r) => r.externalKey).sort();
    expect(externalKeys).toEqual(
      [`fixedplan-adj:${householdId}:2026-01:47086`, `fixedplan-adj:${householdId}:2026-01:${effectiveAfterFirst}`].sort(),
    );

    // The ledger reflects BOTH corrections, not just the first.
    const totalAdjustmentCents = adjustmentRows.reduce((sum, r) => sum + r.amountCents, 0);
    const balance = await body<{ balanceCents: number }>(await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie }));
    expect(balance.balanceCents).toBe(47_086 + totalAdjustmentCents);
  });

  test("swapping the plan payer leaves already-booked periods alone", async () => {
    // Review finding: `recalculatePlan` recomputed every historical period with
    // the CURRENT `fixedCostPlans.payerId`. That column is mutable and carries
    // no history, so the moment a household decided the other person takes over
    // the fixed costs, the two incomes swapped places in `share(other) =
    // income × costTotal / incomeTotal` and every already-booked month reported
    // a delta that corresponded to no change in the data at all.
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Zahlerwechsel");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId); // payer = owner, booked 2026-01 at 47 086
    await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} });

    const swap = await call(`/api/households/${householdId}/finance/plan`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { payerId: partner.id },
    });
    expect(swap.status).toBe(200);

    // Nothing about January's data changed, so there is nothing to correct.
    const preview = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: true } }),
    );
    expect(preview.items).toEqual([]);
    expect(preview.totalDeltaCents).toBe(0);

    const applied = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(applied.adjustments).toEqual([]);
    const adjustmentRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan_adjustment")));
    expect(adjustmentRows).toHaveLength(0);

    // A REAL retroactive change is still corrected — and attributed to the
    // payer January was booked under, not to whoever pays now.
    const plan = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    const partnerIncome = plan.incomes.find((i) => i.personId === partner.id)!;
    await call(`/api/households/${householdId}/finance/plan/incomes/${partnerIncome.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { amountCents: 250_000 },
    });
    const correction = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(correction.adjustments).toHaveLength(1);
    const correctionRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "fixed_plan_adjustment")));
    expect(correctionRows).toHaveLength(1);
    expect(correctionRows[0]?.payerId).toBe(owner.id);
  });

  test("a period whose share rounded to ZERO is still correctable afterwards", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Nullanteil");
    await joinAsSecondMember(owner, householdId, partner);

    // 1 € of fixed costs against a 500 000 : 100 income split — the partner's
    // share is round(100 × 100 / 500 100) = 0, so the run books NOTHING.
    await call(`/api/households/${householdId}/finance/plan/items`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Mini-Fixkosten", amountCents: 100, activeFrom: "2026-01" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: owner.id, amountCents: 500_000, validFrom: "2026-01" },
    });
    await call(`/api/households/${householdId}/finance/plan/incomes`, {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: partner.id, amountCents: 100, validFrom: "2026-01" },
    });
    await call(`/api/households/${householdId}/finance/plan`, { method: "PATCH", cookie: owner.cookie, body: { enabled: true } });

    const run = await body<RunPlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} }),
    );
    expect(run.bookedPeriods).toEqual([]);
    expect(run.skippedPeriods).toEqual(["2026-01"]);
    const rowsAfterRun = await db.select().from(transactions).where(eq(transactions.householdId, householdId));
    expect(rowsAfterRun).toHaveLength(0); // no row at all — this is what hides the period

    // …and the run still moved past it, so the catch-up loop will never return.
    const planAfterRun = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    expect(planAfterRun.plan.lastBookedPeriod).toBe("2026-01");
    expect(planAfterRun.pendingPeriods).toEqual([]);

    // Retroactive correction: the partner really earned 500 000 in January,
    // so their share becomes round(500 000 × 100 / 1 000 000) = 50 ct.
    const partnerIncome = planAfterRun.incomes.find((i) => i.personId === partner.id)!;
    await call(`/api/households/${householdId}/finance/plan/incomes/${partnerIncome.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { amountCents: 500_000 },
    });

    const preview = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: true } }),
    );
    // Without the fix this is `[]`: recalculate iterated `fixed_plan` ROWS, and
    // a zero-share period has none — the 50 ct would be unreachable for good.
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ period: "2026-01", bookedCents: 0, recomputedCents: 50, deltaCents: 50 });

    const applied = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(applied.applied).toBe(true);
    expect(applied.adjustments).toHaveLength(1);
    const balance = await body<{ balanceCents: number }>(await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie }));
    expect(balance.balanceCents).toBe(50);

    // Re-running against unchanged data stays a no-op (externalKey collision).
    const reapply = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: false } }),
    );
    expect(reapply.items).toHaveLength(0);
    expect(reapply.adjustments).toHaveLength(0);
  });

  test("a period covered by an IMPORT row is never given a plan adjustment", async () => {
    setClockForTest(FEB);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Import deckt ab");
    await joinAsSecondMember(owner, householdId, partner);
    await seedFullPlan(owner, partner, householdId);

    // The one-time xlsx rent series already owns 2026-01 (ledger-spec.md §4.7).
    const timestamp = Date.now();
    await db.insert(transactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId: owner.id,
      splitMode: "OTHER_ONLY",
      amountCents: 47_086,
      description: "Miete 01/2026",
      categoryId: null,
      bookedAt: timestamp,
      dateSource: "exact",
      origin: "import",
      planPeriod: "2026-01",
      categorySource: "manual",
      importSeq: 1,
      externalKey: `xlsx:rent:2026-01`,
      createdBy: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await call(`/api/households/${householdId}/finance/plan/run`, { method: "POST", cookie: owner.cookie, body: {} });

    // Change the income so a recalculation WOULD want to adjust 2026-01…
    const plan = await body<PlanResponse>(await call(`/api/households/${householdId}/finance/plan`, { cookie: owner.cookie }));
    const ownerIncome = plan.incomes.find((i) => i.personId === owner.id)!;
    await call(`/api/households/${householdId}/finance/plan/incomes/${ownerIncome.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { amountCents: 400_000 },
    });

    const preview = await body<RecalculatePlanResponse>(
      await call(`/api/households/${householdId}/finance/plan/recalculate`, { method: "POST", cookie: owner.cookie, body: { dryRun: true } }),
    );
    // …but 2026-01 belongs to the import, not to the plan. Only 2026-02 (which
    // the plan really did book) may appear.
    expect(preview.items.map((line) => line.period)).toEqual(["2026-02"]);
  });
});
