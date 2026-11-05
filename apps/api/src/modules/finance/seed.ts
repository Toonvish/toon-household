/**
 * The finance module's demo data (plan M3-T09, the manifest's `seedDemo`): two participants
 * (the demo user in slot 1, "Robin" in slot 2) and a non-participant ("Kim", a plain
 * household member who sees nothing of the ledger, plan decision 3); about eight
 * transactions covering the four kinds, one settlement, the fixed-cost items and both
 * incomes, the plan enabled from two periods ago and one catch-up run.
 *
 * Called by `scripts/seed.ts` after the core demo rows, on the shared `db` client (the current
 * executor of `Database`, handed in through `Database.layerFromExecutor`): this module never closes it and never
 * runs migrations. Idempotent: users are matched by
 * e-mail, the participants are seated only when the household has none, and the ledger
 * block is skipped once the household has a `finance_transactions` row. Everything is
 * written through the services, so the seed exercises the same rules as the API. Content
 * language is German on purpose (demo data, not interface copy), so nothing here goes
 * through `t()`.
 *
 * Logins: robin@toon.local and kim@toon.local, with the demo user's password: the
 * `demoPassword` `scripts/seed.ts` resolved (`SEED_PASSWORD`, else demo1234; plan m3b
 * decision 17). The log prints it only outside production.
 *
 * The hook is an Effect since E4 (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P5, P6, P13):
 * `seedFinanceDemo(context)` needs `Database` only. The finance services are built over that
 * `Database` by `withFinanceServices` (a local memo map, `./layer.ts`), the core `HouseholdModules`
 * by `Effect.provide(HouseholdModules.layer, { local: true })`, and finance is enabled through
 * `HouseholdModules.enableModule` (the registry's `onEnable`, BEFORE the `household_modules` upsert).
 * TDZ: this file sits inside the import cycle `core/services/auth/users.ts` -> core
 * `households/modules.ts` -> `modules/index.ts` -> `finance/index.ts` -> here -> core
 * `households/modules.ts` (still evaluating), so its module scope reads no core binding: the
 * combinators handed to `Effect.fn` are lambdas that read `HouseholdModules` when the hook runs.
 * `Date.now()` / `new Date(…)` stay (outside `services/`, demo timestamps relative to the wall
 * clock, as recipe's seed); the module-clock read is `financeTimeMillis`.
 */
import { comparePeriods, currentPeriod, previousPeriod, type TxKindValue } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { HouseholdModules } from "../../core/services/households/modules.ts";
import { Database } from "../../db/database.ts";
import { householdMembers, users } from "../../db/schema.ts";
import { env } from "../../env.ts";
import type { SeedDemoContext } from "../types.ts";
import { withFinanceServices } from "./layer.ts";
import { financeTimeMillis } from "./lib/clock.ts";
import { financeParticipants, financeTransactions } from "./schema.ts";
import { FinanceCategories } from "./services/categories/categories.service.ts";
import { FinanceBalance } from "./services/ledger/balance.service.ts";
import { FinanceSettlements } from "./services/ledger/settlements.service.ts";
import { FinanceTransactions } from "./services/ledger/transactions.service.ts";
import { FinanceAccrual } from "./services/plan/accrual.service.ts";
import { FinancePlan } from "./services/plan/plan.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Finds the user by e-mail or creates a verified one (the seed vouches for the fictional address). */
const ensureUser = Effect.fnUntraced(function* (email: string, name: string, password: string) {
  const database = yield* Database;
  const existing = yield* database.use((db) =>
    db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1),
  );
  if (existing[0]) return existing[0].id;
  const id = crypto.randomUUID();
  const now = Date.now();
  const passwordHash = yield* Effect.promise(() => Bun.password.hash(password, { algorithm: "argon2id" }));
  yield* database.use((db) =>
    db.insert(users).values({
      id,
      email,
      name,
      emailVerified: true,
      emailVerifiedAt: now,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    }),
  );
  // The password only outside production: there it is the operator's own SEED_PASSWORD.
  console.log(
    env.isProduction ? `[seed] user ${email}` : `[seed] user ${email} / ${password}`,
  );
  return id;
});

const ensureMember = Effect.fnUntraced(function* (householdId: string, userId: string) {
  const database = yield* Database;
  const existing = yield* database.use((db) =>
    db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
      .limit(1),
  );
  if (existing[0]) return;
  yield* database.use((db) =>
    db.insert(householdMembers).values({
      id: crypto.randomUUID(),
      householdId,
      userId,
      role: "member",
      createdAt: Date.now(),
    }),
  );
});

interface DemoTransaction {
  /** Whose view the kind is written from. */
  by: "demo" | "robin";
  kind: TxKindValue;
  amountCents: number;
  description: string;
  category: string;
  tags?: string[];
  daysAgo: number;
}

/** The manifest's `seedDemo` hook: the demo content on the current executor of `Database`. */
export const seedFinanceDemo = Effect.fn("FinanceModule.seedDemo")(
  function* ({ householdId, userId, demoPassword }: SeedDemoContext) {
    const database = yield* Database;
    const householdModules = yield* HouseholdModules;
    const categories = yield* FinanceCategories;
    const transactions = yield* FinanceTransactions;
    const balances = yield* FinanceBalance;
    const settlements = yield* FinanceSettlements;
    const plan = yield* FinancePlan;
    const accrual = yield* FinanceAccrual;

    const robinId = yield* ensureUser("robin@toon.local", "Robin", demoPassword);
    const kimId = yield* ensureUser("kim@toon.local", "Kim", demoPassword);
    yield* ensureMember(householdId, robinId);
    yield* ensureMember(householdId, kimId);

    const seated = yield* database.use((db) =>
      db
        .select({ userId: financeParticipants.userId })
        .from(financeParticipants)
        .where(eq(financeParticipants.householdId, householdId))
        .limit(1),
    );
    if (seated.length === 0) {
      yield* householdModules.enableModule(householdId, "finance", {
        participants: [
          { userId, memberSlot: 1 },
          { userId: robinId, memberSlot: 2 },
        ],
      });
      console.log("[seed] finance enabled: demo = Person 1, Robin = Person 2, Kim stays a non-participant");
    }

    const booked = yield* database.use((db) =>
      db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.householdId, householdId))
        .limit(1),
    );
    if (booked.length > 0) {
      console.log("[seed] finance ledger already present");
      return;
    }

    const viewerOf = { demo: userId, robin: robinId } as const;
    const now = yield* financeTimeMillis;
    const book = Effect.fnUntraced(function* (demo: DemoTransaction) {
      const viewerId = viewerOf[demo.by];
      yield* transactions.createTransaction({
        householdId,
        viewerId,
        createdBy: viewerId,
        kind: demo.kind,
        amountCents: demo.amountCents,
        description: demo.description,
        categoryId: yield* categories.categoryIdBySlug(householdId, demo.category),
        tags: demo.tags ?? [],
        bookedAt: new Date(now - demo.daysAgo * DAY_MS).toISOString(),
      });
    });

    // The four kinds: MINE_SPLIT / THEIRS_SPLIT split 50:50 (the viewer or the other paid),
    // FOR_THEM is the payer covering the other person's cost, TRANSFER a plain money transfer.
    const before: DemoTransaction[] = [
      { by: "demo", kind: "MINE_SPLIT", amountCents: 8_642, description: "Wocheneinkauf", category: "lebensmittel", tags: ["Supermarkt"], daysAgo: 21 },
      { by: "robin", kind: "MINE_SPLIT", amountCents: 6_410, description: "Tankstelle", category: "mobilitaet", daysAgo: 17 },
      { by: "demo", kind: "FOR_THEM", amountCents: 3_999, description: "Geschenk für Robins Geburtstag", category: "geschenke", daysAgo: 14 },
      { by: "robin", kind: "THEIRS_SPLIT", amountCents: 4_820, description: "Kino und Popcorn", category: "freizeit", tags: ["Kino"], daysAgo: 12 },
      { by: "demo", kind: "TRANSFER", amountCents: 5_000, description: "Bargeld für die Haushaltskasse", category: "sonstiges", daysAgo: 10 },
    ];
    for (const demo of before) yield* book(demo);

    // One settlement of the whole balance, then a few more bookings so the balance is not zero.
    const balance = yield* balances.getBalance(householdId, userId, 1, true);
    if (balance.balanceCents !== 0) {
      yield* settlements.createSettlement(householdId, userId, 1, {
        expectedBalanceCents: balance.balanceCents,
        bookedAt: new Date(now - 8 * DAY_MS).toISOString(),
      });
    }

    const after: DemoTransaction[] = [
      { by: "robin", kind: "MINE_SPLIT", amountCents: 12_390, description: "Drogerie und Haushaltsbedarf", category: "drogerie", daysAgo: 5 },
      { by: "demo", kind: "MINE_SPLIT", amountCents: 7_255, description: "Wocheneinkauf", category: "lebensmittel", tags: ["Supermarkt"], daysAgo: 2 },
      { by: "demo", kind: "THEIRS_SPLIT", amountCents: 2_850, description: "Pizza vom Lieferdienst", category: "lebensmittel", daysAgo: 1 },
    ];
    for (const demo of after) yield* book(demo);
    console.log(`[seed] ${before.length + after.length} transactions and 1 settlement`);

    // The Fixkostenplan: the items run from this year's January (or from the plan's start when
    // that is earlier, i.e. in January and February), the plan from two periods ago.
    const startPeriod = previousPeriod(previousPeriod(currentPeriod(now)));
    const january = `${currentPeriod(now).slice(0, 4)}-01`;
    const activeFrom = comparePeriods(january, startPeriod) < 0 ? january : startPeriod;
    yield* plan.createFixedCostItem(householdId, { label: "Miete", amountCents: 95_000, activeFrom });
    yield* plan.createFixedCostItem(householdId, { label: "Strom", amountCents: 8_000, activeFrom });
    yield* plan.createIncome(householdId, { personId: userId, amountCents: 320_000, validFrom: activeFrom });
    yield* plan.createIncome(householdId, { personId: robinId, amountCents: 240_000, validFrom: activeFrom });
    yield* plan.updatePlan(householdId, { enabled: true, startPeriod });
    const run = yield* accrual.runCatchUp(householdId, { trigger: "manual", requireEnabled: false, throwOnIncomplete: false });
    console.log(`[seed] Fixkostenplan from ${startPeriod}: ${run.bookedPeriods.length} period(s) booked`);
  },
  // TDZ (P5, P13): lambdas, so `HouseholdModules` and `withFinanceServices` are read when the hook runs, never at import.
  (effect) => effect.pipe(Effect.provide(HouseholdModules.layer, { local: true })),
  (effect) => withFinanceServices(effect),
);
