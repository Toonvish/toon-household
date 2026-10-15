/**
 * The finance-side fixes of toon-finance's security review (F `1715207`, plan m3b T07;
 * F `apps/api/test/security.test.ts`, the domain cases): the plan only ever names participants,
 * period and request bounds, LIKE escaping, household-scoped idempotency reads, the accrual
 * run's error text, and the two "leaving" cases as ADR 0004 asserts them in H.
 *
 * The browser-facing cases of the same F file (origin guard, auth body parsing, headers) are the
 * core's `security.test.ts` (M3b-T06). Shared `db` + `runMigrations(db)`; users and households
 * come from the finance harness, i.e. the real core routes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { setClockForTest } from "../src/modules/finance/lib/clock.ts";
import { financeAccrualRuns, financeFixedCostPlans, financeTransactions } from "../src/modules/finance/schema.ts";
import { runCatchUp } from "../src/modules/finance/services/plan/accrual.service.ts";
import {
  addMember,
  body,
  call,
  createHousehold,
  createPlainHousehold,
  createUser,
  enableFinance,
  joinAsSecondMember,
} from "./support/finance-harness.ts";

await runMigrations(db);

afterEach(() => setClockForTest(null));

interface ErrorBody {
  error: { code: string; message: string; details?: Array<{ path?: string }> };
}
interface PlanBody {
  plan: { enabled: boolean; payerId: string };
}

const financePath = (householdId: string, rest: string): string => `/api/households/${householdId}/finance${rest}`;

async function errorOf(response: Response): Promise<ErrorBody["error"]> {
  return (await body<ErrorBody>(response)).error;
}

describe("the fixed-cost plan only ever names participants", () => {
  test("F: PATCH …/plan { payerId } and POST …/plan/incomes { personId } refuse a stranger's id (H: 422 personNotParticipant, not 404)", async () => {
    const owner = await createUser("PlanOwner");
    const stranger = await createUser("Stranger");
    const householdId = await createHousehold(owner, "Planhaushalt");

    const payer = await call(financePath(householdId, "/plan"), {
      method: "PATCH",
      cookie: owner.cookie,
      body: { payerId: stranger.id },
    });
    expect(payer.status).toBe(422);
    expect((await errorOf(payer)).code).toBe("validation_failed");

    const income = await call(financePath(householdId, "/plan/incomes"), {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: stranger.id, amountCents: 100_000, validFrom: "2026-01" },
    });
    expect(income.status).toBe(422);
    expect((await errorOf(income)).details?.[0]?.path).toBe("personId");
  });

  test("F: switching the plan on re-checks the stored payer: a payer who is no participant any more is 422", async () => {
    const owner = await createUser("Enable");
    const stranger = await createUser("Gone");
    const householdId = await createHousehold(owner, "Einschalten");
    // The payer of record names a user who holds no seat (a departed participant, by hand).
    await db.update(financeFixedCostPlans).set({ payerId: stranger.id }).where(eq(financeFixedCostPlans.householdId, householdId));

    const on = await call(financePath(householdId, "/plan"), { method: "PATCH", cookie: owner.cookie, body: { enabled: true } });
    expect(on.status).toBe(422);
    expect((await errorOf(on)).details?.[0]?.path).toBe("payerId");
    const plan = await body<PlanBody>(await call(financePath(householdId, "/plan"), { cookie: owner.cookie }));
    expect(plan.plan.enabled).toBe(false);

    // Naming a participant in the same request is the way out.
    const fixed = await call(financePath(householdId, "/plan"), {
      method: "PATCH",
      cookie: owner.cookie,
      body: { enabled: true, payerId: owner.id },
    });
    expect(fixed.status).toBe(200);
  });
});

describe("period bounds and ranges", () => {
  test("F: a period before 2000 or after 2100 or a range ending before it starts is 422, never a 500", async () => {
    const owner = await createUser("Bounds");
    const householdId = await createHousehold(owner, "Grenzen");

    for (const startPeriod of ["0001-01", "1999-12", "2101-01"]) {
      const response = await call(financePath(householdId, "/plan"), {
        method: "PATCH",
        cookie: owner.cookie,
        body: { startPeriod },
      });
      expect([startPeriod, response.status]).toEqual([startPeriod, 422]);
    }

    const inverted = await call(financePath(householdId, "/plan/items"), {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Miete", amountCents: 100, activeFrom: "2026-05", activeTo: "2026-01" },
    });
    expect(inverted.status).toBe(422);
    const invertedError = await errorOf(inverted);
    expect(invertedError.code).toBe("validation_failed");
    expect(invertedError.message).toBe("Das Ende darf nicht vor dem Beginn liegen.");
  });

  test("F: a PATCH moving activeTo / validTo before the row's own start is 422 (the row's other half is read in the service)", async () => {
    const owner = await createUser("Halves");
    const householdId = await createHousehold(owner, "Hälften");

    const item = await body<{ id: string }>(
      await call(financePath(householdId, "/plan/items"), {
        method: "POST",
        cookie: owner.cookie,
        body: { label: "Miete", amountCents: 100, activeFrom: "2026-05" },
      }),
    );
    const itemPatch = await call(financePath(householdId, `/plan/items/${item.id}`), {
      method: "PATCH",
      cookie: owner.cookie,
      body: { activeTo: "2026-01" },
    });
    expect(itemPatch.status).toBe(422);
    expect((await errorOf(itemPatch)).message).toBe("Das Ende darf nicht vor dem Beginn liegen.");
    const itemFromPatch = await call(financePath(householdId, `/plan/items/${item.id}`), {
      method: "PATCH",
      cookie: owner.cookie,
      body: { activeFrom: "2026-09", activeTo: "2026-07" },
    });
    expect(itemFromPatch.status).toBe(422);

    const incomeCreate = await call(financePath(householdId, "/plan/incomes"), {
      method: "POST",
      cookie: owner.cookie,
      body: { personId: owner.id, amountCents: 100_000, validFrom: "2026-05", validTo: "2026-01" },
    });
    expect(incomeCreate.status).toBe(422);
    const income = await body<{ id: string }>(
      await call(financePath(householdId, "/plan/incomes"), {
        method: "POST",
        cookie: owner.cookie,
        body: { personId: owner.id, amountCents: 100_000, validFrom: "2026-05" },
      }),
    );
    const incomePatch = await call(financePath(householdId, `/plan/incomes/${income.id}`), {
      method: "PATCH",
      cookie: owner.cookie,
      body: { validTo: "2026-01" },
    });
    expect(incomePatch.status).toBe(422);

    // A valid range still goes through.
    const ok = await call(financePath(householdId, `/plan/items/${item.id}`), {
      method: "PATCH",
      cookie: owner.cookie,
      body: { activeTo: "2026-08" },
    });
    expect(ok.status).toBe(200);
  });
});

describe("leaving a household (ADR 0004 asserts H's rule where toon-finance 1715207 refused)", () => {
  const membersPath = (householdId: string, userId: string): string => `/api/households/${householdId}/members/${userId}`;

  async function bookRow(householdId: string, payerId: string): Promise<void> {
    await db.insert(financeTransactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId,
      splitMode: "SPLIT_EQUAL",
      amountCents: 1_000,
      description: "Einkauf",
      bookedAt: Date.now(),
      dateSource: "day",
      origin: "manual",
      categorySource: "manual",
    });
  }

  test("F: slot 1 cannot leave while slot 2 is seated (H: ADR 0004 re-seat on an empty ledger, 409 member_has_ledger with rows)", async () => {
    const owner = await createUser("Owner");
    const anchor = await createUser("Anchor");
    const householdId = await createPlainHousehold(owner, "Verlassen");
    await addMember(owner, householdId, anchor);
    expect((await enableFinance(owner, householdId, anchor, owner)).status).toBe(200);

    // With a booking the anchor's balance would hang off a non-member: refused, nothing changes.
    await bookRow(householdId, owner.id);
    const refused = await call(membersPath(householdId, anchor.id), { method: "DELETE", cookie: anchor.cookie });
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("member_has_ledger");
    await db.delete(financeTransactions).where(eq(financeTransactions.householdId, householdId));

    // On an empty ledger the anchor leaves, the survivor takes slot 1 and the ledger stays readable
    // (toon-finance refused here: its leaver's slot could not be re-seated).
    const left = await call(membersPath(householdId, anchor.id), { method: "DELETE", cookie: anchor.cookie });
    expect(left.status).toBe(204);
    const participants = await body<{ items: Array<{ userId: string; memberSlot: number }> }>(
      await call(financePath(householdId, "/participants"), { cookie: owner.cookie }),
    );
    expect(participants.items.map((item) => [item.userId, item.memberSlot])).toEqual([[owner.id, 1]]);
    expect((await call(financePath(householdId, "/balance"), { cookie: owner.cookie })).status).toBe(200);
  });

  test("F: the payer of an ENABLED plan cannot leave (H: the payer follows on an empty ledger, 409 member_has_ledger with rows)", async () => {
    const owner = await createUser("Payer");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Aktiv");
    await joinAsSecondMember(owner, householdId, partner);
    expect(
      (
        await call(financePath(householdId, "/plan"), {
          method: "PATCH",
          cookie: owner.cookie,
          body: { enabled: true, payerId: partner.id },
        })
      ).status,
    ).toBe(200);

    // Empty ledger: the partner leaves, the (still enabled) plan's payer is the one who stays.
    const left = await call(membersPath(householdId, partner.id), { method: "DELETE", cookie: partner.cookie });
    expect(left.status).toBe(204);
    const plan = await body<PlanBody>(await call(financePath(householdId, "/plan"), { cookie: owner.cookie }));
    expect(plan.plan.payerId).toBe(owner.id);
    expect(plan.plan.enabled).toBe(true);

    // The same constellation with a booking in the ledger: refused, the payer keeps the seat.
    const owner2 = await createUser("Payer2");
    const partner2 = await createUser("Partner2");
    const household2 = await createHousehold(owner2, "Aktiv mit Buchung");
    await joinAsSecondMember(owner2, household2, partner2);
    await call(financePath(household2, "/plan"), {
      method: "PATCH",
      cookie: owner2.cookie,
      body: { enabled: true, payerId: partner2.id },
    });
    await bookRow(household2, owner2.id);
    const refused = await call(membersPath(household2, partner2.id), { method: "DELETE", cookie: partner2.cookie });
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("member_has_ledger");
  });
});

describe("request bounds", () => {
  test("F: more than 20 tags on one transaction is 422, exactly 20 is fine", async () => {
    const owner = await createUser("Tagger");
    const householdId = await createHousehold(owner, "Tags");
    const post = (count: number) =>
      call(financePath(householdId, "/transactions"), {
        method: "POST",
        cookie: owner.cookie,
        body: {
          kind: "MINE_SPLIT",
          amountCents: 100,
          description: "viele",
          tags: Array.from({ length: count }, (_, index) => `t${index}`),
        },
      });
    expect((await post(21)).status).toBe(422);
    expect((await post(20)).status).toBe(201);
  });

  test("F: q over 100 characters and tagIds over 400 characters are 422 on the list; tagIds beyond ten distinct ids are cut, not an error", async () => {
    const owner = await createUser("Bounded");
    const householdId = await createHousehold(owner, "Grenzen der Anfrage");
    const list = (query: string) => call(financePath(householdId, `/transactions?${query}`), { cookie: owner.cookie });
    expect((await list(`q=${"a".repeat(101)}`)).status).toBe(422);
    expect((await list(`q=${"a".repeat(100)}`)).status).toBe(200);
    expect((await list(`tagIds=${"a".repeat(401)}`)).status).toBe(422);
    const many = Array.from({ length: 15 }, () => crypto.randomUUID().slice(0, 8)).join(",");
    expect((await list(`tagIds=${many}`)).status).toBe(200);
    expect((await call(financePath(householdId, `/tags?q=${"a".repeat(101)}`), { cookie: owner.cookie })).status).toBe(422);
  });

  test("F: LIKE metacharacters in ?q= match themselves, not everything", async () => {
    const owner = await createUser("Searcher");
    const householdId = await createHousehold(owner, "Suche");
    for (const description of ["Brot", "100% Saft", "a_b"]) {
      const created = await call(financePath(householdId, "/transactions"), {
        method: "POST",
        cookie: owner.cookie,
        body: { kind: "MINE_SPLIT", amountCents: 100, description },
      });
      expect(created.status).toBe(201);
    }
    const total = async (q: string): Promise<number> =>
      (await body<{ total: number }>(await call(financePath(householdId, `/transactions?q=${encodeURIComponent(q)}`), { cookie: owner.cookie })))
        .total;
    expect(await total("%")).toBe(1);
    expect(await total("_")).toBe(1);
    expect(await total("\\")).toBe(0);
    expect(await total("saft")).toBe(1);
  });

  test("F: LIKE metacharacters in the tag autocomplete (?q=) match themselves too", async () => {
    const owner = await createUser("TagSearch");
    const householdId = await createHousehold(owner, "Tagsuche");
    const created = await call(financePath(householdId, "/transactions"), {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "mit Tags", tags: ["%rabatt", "plain"] },
    });
    expect(created.status).toBe(201);
    const names = async (q: string): Promise<string[]> =>
      (await body<{ items: Array<{ name: string }> }>(await call(financePath(householdId, `/tags?q=${encodeURIComponent(q)}`), { cookie: owner.cookie })))
        .items.map((item) => item.name);
    expect(await names("%")).toEqual(["%rabatt"]);
    expect(await names("_")).toEqual([]);
    expect(await names("pl")).toEqual(["plain"]);
  });
});

describe("idempotency claims are household-scoped", () => {
  async function ledgerWithBooking(label: string): Promise<{ owner: Awaited<ReturnType<typeof createUser>>; householdId: string }> {
    const owner = await createUser(`${label}Owner`);
    const partner = await createUser(`${label}Partner`);
    const householdId = await createHousehold(owner, label);
    await joinAsSecondMember(owner, householdId, partner);
    return { owner, householdId };
  }

  test("F: a settlement replay with another household's mutationId is 404, not their row", async () => {
    const a = await ledgerWithBooking("HouseA");
    await call(financePath(a.householdId, "/transactions"), {
      method: "POST",
      cookie: a.owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 1000, description: "A zahlt" },
    });
    const balanceA = await body<{ balanceCents: number }>(await call(financePath(a.householdId, "/balance"), { cookie: a.owner.cookie }));
    const mutationId = crypto.randomUUID();
    const first = await call(financePath(a.householdId, "/settlements"), {
      method: "POST",
      cookie: a.owner.cookie,
      body: { mutationId, amountCents: 500, expectedBalanceCents: balanceA.balanceCents },
    });
    expect(first.status).toBe(201);

    const b = await ledgerWithBooking("HouseB");
    const replay = await call(financePath(b.householdId, "/settlements"), {
      method: "POST",
      cookie: b.owner.cookie,
      body: { mutationId, amountCents: 500, expectedBalanceCents: 0 },
    });
    expect(replay.status).toBe(404);

    // The owner's own replay is still a replay: 200 with the current state, nothing booked twice.
    const own = await call(financePath(a.householdId, "/settlements"), {
      method: "POST",
      cookie: a.owner.cookie,
      body: { mutationId, amountCents: 500, expectedBalanceCents: balanceA.balanceCents },
    });
    expect(own.status).toBe(200);
  });

  test("F: a delete (or patch) replay with another household's mutationId is not a silent no-op; the owner's own replay still is idempotent", async () => {
    const a = await ledgerWithBooking("ClaimA");
    const b = await ledgerWithBooking("ClaimB");
    const mutationId = crypto.randomUUID();
    const bookedByA = await call(financePath(a.householdId, "/transactions"), {
      method: "POST",
      cookie: a.owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 700, description: "A bucht", mutationId },
    });
    expect(bookedByA.status).toBe(201);

    const own = await body<{ id: string }>(
      await call(financePath(b.householdId, "/transactions"), {
        method: "POST",
        cookie: b.owner.cookie,
        body: { kind: "MINE_SPLIT", amountCents: 900, description: "B bucht" },
      }),
    );
    const deleted = await call(financePath(b.householdId, `/transactions/${own.id}?mutationId=${mutationId}`), {
      method: "DELETE",
      cookie: b.owner.cookie,
    });
    expect(deleted.status).toBe(409);
    expect((await errorOf(deleted)).code).toBe("conflict");
    const patched = await call(financePath(b.householdId, `/transactions/${own.id}`), {
      method: "PATCH",
      cookie: b.owner.cookie,
      body: { description: "geändert", mutationId },
    });
    expect(patched.status).toBe(409);
    const still = await body<{ description: string }>(
      await call(financePath(b.householdId, `/transactions/${own.id}`), { cookie: b.owner.cookie }),
    );
    expect(still.description).toBe("B bucht");

    // With its own id the delete applies once and a replay of it answers 204 again.
    const ownId = crypto.randomUUID();
    const first = await call(financePath(b.householdId, `/transactions/${own.id}?mutationId=${ownId}`), {
      method: "DELETE",
      cookie: b.owner.cookie,
    });
    expect(first.status).toBe(204);
    const replay = await call(financePath(b.householdId, `/transactions/${own.id}?mutationId=${ownId}`), {
      method: "DELETE",
      cookie: b.owner.cookie,
    });
    expect(replay.status).toBe(204);
  });
});

describe("the accrual run's audit row", () => {
  test("F: a failed catch-up stores the error's NAME, never its message (a driver message is SQL with bound parameters)", async () => {
    const owner = await createUser("Accrual");
    const householdId = await createHousehold(owner, "Lauf");
    const on = await call(financePath(householdId, "/plan"), { method: "PATCH", cookie: owner.cookie, body: { enabled: true } });
    expect(on.status).toBe(200);

    const secret = "insert into finance_transactions (id, description) values (?, ?) params: sekret-beschreibung";
    // Fails exactly where a driver error would: inside the booking transaction.
    const failing = new Proxy(db, {
      get(target, property) {
        if (property === "transaction") {
          return async () => {
            throw new TypeError(secret);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(
        runCatchUp(failing, householdId, { trigger: "manual", requireEnabled: true, throwOnIncomplete: false }),
      ).rejects.toThrow("insert into");
    } finally {
      console.error = originalError;
    }

    const runs = await db.select().from(financeAccrualRuns).where(eq(financeAccrualRuns.householdId, householdId));
    expect(runs.map((run) => run.error)).toEqual(["TypeError: see server log"]);
    const listed = await call(financePath(householdId, "/plan/runs"), { cookie: owner.cookie });
    expect(JSON.stringify(await listed.json())).not.toContain("sekret");
  });
});
