/**
 * The finance module's demo data (plan M3-T09, the manifest's `seedDemo`): two participants
 * (the demo user in slot 1, "Robin" in slot 2) and a non-participant ("Kim", a plain
 * household member who sees nothing of the ledger, plan decision 3); about eight
 * transactions covering the four kinds, one settlement, the fixed-cost items and both
 * incomes, the plan enabled from two periods ago and one catch-up run.
 *
 * Called by `scripts/seed.ts` after the core demo rows, with the shared `db` client: this
 * module never closes it and never runs migrations. Idempotent: users are matched by
 * e-mail, the participants are seated only when the household has none, and the ledger
 * block is skipped once the household has a `finance_transactions` row. Everything is
 * written through the services, so the seed exercises the same rules as the API. Content
 * language is German on purpose (demo data, not interface copy), so nothing here goes
 * through `t()`.
 *
 * Logins: robin@toon.local and kim@toon.local, password demo1234 (like the demo user).
 */
import { comparePeriods, currentPeriod, previousPeriod, type TxKindValue } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { enableModule } from "../../core/services/households/modules.ts";
import type { Database } from "../../db/client.ts";
import { householdMembers, users } from "../../db/schema.ts";
import { nowMs } from "./lib/clock.ts";
import { financeParticipants, financeTransactions } from "./schema.ts";
import { categoryIdBySlug } from "./services/categories/categories.service.ts";
import { getBalance } from "./services/ledger/balance.service.ts";
import { createSettlement } from "./services/ledger/settlements.service.ts";
import { createTransaction } from "./services/ledger/transactions.service.ts";
import { runCatchUp } from "./services/plan/accrual.service.ts";
import { createFixedCostItem, createIncome, updatePlan } from "./services/plan/plan.service.ts";

const DEMO_PASSWORD = "demo1234";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Finds the user by e-mail or creates a verified one (the seed vouches for the fictional address). */
async function ensureUser(db: Database, email: string, name: string): Promise<string> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0].id;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(users).values({
    id,
    email,
    name,
    emailVerified: true,
    emailVerifiedAt: now,
    passwordHash: await Bun.password.hash(DEMO_PASSWORD, { algorithm: "argon2id" }),
    createdAt: now,
    updatedAt: now,
  });
  console.log(`[seed] user ${email} / ${DEMO_PASSWORD}`);
  return id;
}

async function ensureMember(db: Database, householdId: string, userId: string): Promise<void> {
  const existing = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);
  if (existing[0]) return;
  await db.insert(householdMembers).values({
    id: crypto.randomUUID(),
    householdId,
    userId,
    role: "member",
    createdAt: Date.now(),
  });
}

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

export async function seedFinanceDemo(
  db: Database,
  { householdId, userId }: { householdId: string; userId: string },
): Promise<void> {
  const robinId = await ensureUser(db, "robin@toon.local", "Robin");
  const kimId = await ensureUser(db, "kim@toon.local", "Kim");
  await ensureMember(db, householdId, robinId);
  await ensureMember(db, householdId, kimId);

  const seated = await db
    .select({ userId: financeParticipants.userId })
    .from(financeParticipants)
    .where(eq(financeParticipants.householdId, householdId))
    .limit(1);
  if (seated.length === 0) {
    await enableModule(db, householdId, "finance", {
      participants: [
        { userId, memberSlot: 1 },
        { userId: robinId, memberSlot: 2 },
      ],
    });
    console.log("[seed] finance enabled: demo = Person 1, Robin = Person 2, Kim stays a non-participant");
  }

  const booked = await db
    .select({ id: financeTransactions.id })
    .from(financeTransactions)
    .where(eq(financeTransactions.householdId, householdId))
    .limit(1);
  if (booked.length > 0) {
    console.log("[seed] finance ledger already present");
    return;
  }

  const viewerOf = { demo: userId, robin: robinId } as const;
  const now = nowMs();
  const book = async (demo: DemoTransaction): Promise<void> => {
    const viewerId = viewerOf[demo.by];
    await createTransaction(db, {
      householdId,
      viewerId,
      createdBy: viewerId,
      kind: demo.kind,
      amountCents: demo.amountCents,
      description: demo.description,
      categoryId: await categoryIdBySlug(db, householdId, demo.category),
      tags: demo.tags ?? [],
      bookedAt: new Date(now - demo.daysAgo * DAY_MS).toISOString(),
    });
  };

  // The four kinds: MINE_SPLIT / THEIRS_SPLIT split 50:50 (the viewer or the other paid),
  // FOR_THEM is the payer covering the other person's cost, TRANSFER a plain money transfer.
  const before: DemoTransaction[] = [
    { by: "demo", kind: "MINE_SPLIT", amountCents: 8_642, description: "Wocheneinkauf", category: "lebensmittel", tags: ["Supermarkt"], daysAgo: 21 },
    { by: "robin", kind: "MINE_SPLIT", amountCents: 6_410, description: "Tankstelle", category: "mobilitaet", daysAgo: 17 },
    { by: "demo", kind: "FOR_THEM", amountCents: 3_999, description: "Geschenk für Robins Geburtstag", category: "geschenke", daysAgo: 14 },
    { by: "robin", kind: "THEIRS_SPLIT", amountCents: 4_820, description: "Kino und Popcorn", category: "freizeit", tags: ["Kino"], daysAgo: 12 },
    { by: "demo", kind: "TRANSFER", amountCents: 5_000, description: "Bargeld für die Haushaltskasse", category: "sonstiges", daysAgo: 10 },
  ];
  for (const demo of before) await book(demo);

  // One settlement of the whole balance, then a few more bookings so the balance is not zero.
  const balance = await getBalance(db, householdId, userId, 1, true);
  if (balance.balanceCents !== 0) {
    await createSettlement(db, householdId, userId, 1, {
      expectedBalanceCents: balance.balanceCents,
      bookedAt: new Date(now - 8 * DAY_MS).toISOString(),
    });
  }

  const after: DemoTransaction[] = [
    { by: "robin", kind: "MINE_SPLIT", amountCents: 12_390, description: "Drogerie und Haushaltsbedarf", category: "drogerie", daysAgo: 5 },
    { by: "demo", kind: "MINE_SPLIT", amountCents: 7_255, description: "Wocheneinkauf", category: "lebensmittel", tags: ["Supermarkt"], daysAgo: 2 },
    { by: "demo", kind: "THEIRS_SPLIT", amountCents: 2_850, description: "Pizza vom Lieferdienst", category: "lebensmittel", daysAgo: 1 },
  ];
  for (const demo of after) await book(demo);
  console.log(`[seed] ${before.length + after.length} transactions and 1 settlement`);

  // The Fixkostenplan: the items run from this year's January (or from the plan's start when
  // that is earlier, i.e. in January and February), the plan from two periods ago.
  const startPeriod = previousPeriod(previousPeriod(currentPeriod(now)));
  const january = `${currentPeriod(now).slice(0, 4)}-01`;
  const activeFrom = comparePeriods(january, startPeriod) < 0 ? january : startPeriod;
  await createFixedCostItem(db, householdId, { label: "Miete", amountCents: 95_000, activeFrom });
  await createFixedCostItem(db, householdId, { label: "Strom", amountCents: 8_000, activeFrom });
  await createIncome(db, householdId, { personId: userId, amountCents: 320_000, validFrom: activeFrom });
  await createIncome(db, householdId, { personId: robinId, amountCents: 240_000, validFrom: activeFrom });
  await updatePlan(db, householdId, { enabled: true, startPeriod });
  const run = await runCatchUp(db, householdId, { trigger: "manual", requireEnabled: false, throwOnIncomplete: false });
  console.log(`[seed] Fixkostenplan from ${startPeriod}: ${run.bookedPeriods.length} period(s) booked`);
}
