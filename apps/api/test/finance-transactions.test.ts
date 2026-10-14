/**
 * Integration tests for /api/households/:householdId/finance/transactions: the four
 * UI kinds resolve to the right `(payerId, splitMode)` and derived shares,
 * `mutationId` replay never double-books, generated rows are protected from
 * PATCH/DELETE, and the list's filters + pagination behave.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { financeTransactions as transactions } from "../src/modules/finance/schema.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { body, call, createHousehold, createSoloFinanceHousehold, createUser, joinAsSecondMember, type TestUser } from "./support/finance-harness.ts";

await runMigrations(db);

interface ErrorPayload {
  error: { code: string; message: string };
}
interface TransactionResponse {
  id: string;
  payerId: string;
  splitMode: "SPLIT_EQUAL" | "OTHER_ONLY" | "SETTLEMENT";
  amountCents: number;
  description: string;
  categoryId: string | null;
  otherShareCents: number;
  payerShareCents: number;
  balanceDeltaCents: number;
  isExpense: boolean;
  origin: string;
  tags: { id: string; name: string }[];
}
interface TransactionListResponse {
  items: TransactionResponse[];
  total: number;
  limit: number;
  offset: number;
}
interface TransactionSummaryResponse {
  totalExpenseCents: number;
  byCategory: { categoryId: string | null; totalCents: number; count: number }[];
  byMonth: { period: string; totalCents: number; balanceDeltaCents: number }[];
  settlementTotalCents: number;
}

describe("POST /api/households/:householdId/finance/transactions — the four kinds", () => {
  test("MINE_SPLIT, THEIRS_SPLIT, FOR_THEM, TRANSFER store the right (payerId, splitMode) and derived shares", async () => {
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Vier Arten");
    await joinAsSecondMember(owner, householdId, partner);

    const mine = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions`, {
        method: "POST",
        cookie: owner.cookie,
        body: { kind: "MINE_SPLIT", amountCents: 10_001, description: "Ich geteilt" },
      }),
    );
    expect(mine.payerId).toBe(owner.id);
    expect(mine.splitMode).toBe("SPLIT_EQUAL");
    expect(mine.otherShareCents).toBe(5_000);
    expect(mine.payerShareCents).toBe(5_001);
    expect(mine.balanceDeltaCents).toBe(5_000); // owner is slot 1
    expect(mine.isExpense).toBe(true);

    const theirs = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions`, {
        method: "POST",
        cookie: owner.cookie,
        body: { kind: "THEIRS_SPLIT", amountCents: 10_001, description: "Partner geteilt" },
      }),
    );
    expect(theirs.payerId).toBe(partner.id);
    expect(theirs.splitMode).toBe("SPLIT_EQUAL");
    expect(theirs.balanceDeltaCents).toBe(-5_000);

    const forThem = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions`, {
        method: "POST",
        cookie: owner.cookie,
        body: { kind: "FOR_THEM", amountCents: 2_000, description: "Für Partner" },
      }),
    );
    expect(forThem.payerId).toBe(owner.id);
    expect(forThem.splitMode).toBe("OTHER_ONLY");
    expect(forThem.otherShareCents).toBe(2_000);
    expect(forThem.payerShareCents).toBe(0);
    expect(forThem.balanceDeltaCents).toBe(2_000);

    const transfer = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions`, {
        method: "POST",
        cookie: owner.cookie,
        body: { kind: "TRANSFER", amountCents: 1_500, description: "Ausgleich" },
      }),
    );
    expect(transfer.payerId).toBe(partner.id);
    expect(transfer.splitMode).toBe("SETTLEMENT");
    expect(transfer.isExpense).toBe(false);
    expect(transfer.balanceDeltaCents).toBe(-1_500);

    // From the partner's own login, THEIRS_SPLIT reads back through the
    // ?kind= projection filter as expected — same row, mirrored perspective.
    const partnerView = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?kind=MINE_SPLIT`, { cookie: partner.cookie }),
    );
    expect(partnerView.items.map((t) => t.id)).toContain(theirs.id);
  });

  test("a negative amount is valid and signed; zero is rejected", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Negativ");

    const refund = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "FOR_THEM", amountCents: -4684, description: "Rückzahlung" },
    });
    expect(refund.status).toBe(201);
    expect((await body<TransactionResponse>(refund)).balanceDeltaCents).toBe(-4684);

    const zero = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 0, description: "Null" },
    });
    expect(zero.status).toBe(422);
    // The wire contract (docs/spec.md §3.2/§3.6) promises this EXACT code, not
    // the generic `validation_failed` a Zod `.refine()` would produce
    // (review finding: `transaction_amount_zero` was declared but unreachable).
    expect((await body<{ error: { code: string } }>(zero)).error.code).toBe("transaction_amount_zero");
  });

  test("?kind=THEIRS_SPLIT/TRANSFER match nothing while the ledger has only one participant", async () => {
    // Review finding: the filter used to resolve its `otherId` as
    // `otherMemberId(...) ?? viewerId`, so with the second seat still an open
    // invite `THEIRS_SPLIT` compiled to `payer = viewer AND SPLIT_EQUAL` — the
    // MINE_SPLIT filter — and answered "what did the other person pay?" with
    // the viewer's OWN rows. The filter now reads the way `projectKind` does:
    // the payer is not the viewer.
    // H: one participant cannot be reached through the API (onEnable needs two, M3 decision 4); the harness seeds it
    // directly so this filter regression stays pinned.
    const solo = await createUser("Solo");
    const householdId = await createSoloFinanceHousehold(solo, "Allein");

    const mine = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions`, {
        method: "POST",
        cookie: solo.cookie,
        body: { kind: "MINE_SPLIT", amountCents: 2_000, description: "Eigene Ausgabe" },
      }),
    );

    const mineFilter = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?kind=MINE_SPLIT`, { cookie: solo.cookie }),
    );
    expect(mineFilter.items.map((t) => t.id)).toEqual([mine.id]);

    for (const kind of ["THEIRS_SPLIT", "TRANSFER"] as const) {
      const list = await body<TransactionListResponse>(
        await call(`/api/households/${householdId}/finance/transactions?kind=${kind}`, { cookie: solo.cookie }),
      );
      expect(list.items).toEqual([]);
      expect(list.total).toBe(0);
    }
  });
});

describe("idempotency of POST", () => {
  test("a replayed mutationId books nothing twice and answers 200 the second time", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Replay");
    const mutationId = crypto.randomUUID();

    const first = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 999, description: "Einmalig", mutationId },
    });
    expect(first.status).toBe(201);
    const firstPayload = await body<TransactionResponse>(first);

    const second = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 999, description: "Einmalig", mutationId },
    });
    expect(second.status).toBe(200);
    const secondPayload = await body<TransactionResponse>(second);
    expect(secondPayload.id).toBe(firstPayload.id);

    const rows = await db.select().from(transactions).where(eq(transactions.householdId, householdId));
    expect(rows).toHaveLength(1);
  });
});

describe("generated rows are protected", () => {
  test("PATCH and DELETE on a non-manual origin answer 409 transaction_generated", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Generiert");
    const id = crypto.randomUUID();
    await db.insert(transactions).values({
      id,
      householdId,
      payerId: owner.id,
      splitMode: "OTHER_ONLY",
      amountCents: 47_086,
      description: "Fixkostenanteil 08/2026",
      bookedAt: Date.now(),
      dateSource: "exact",
      origin: "fixed_plan",
      planPeriod: "2026-08",
      categorySource: "system",
      externalKey: `fixedplan:${householdId}:2026-08`,
    });

    const patch = await call(`/api/households/${householdId}/finance/transactions/${id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { description: "Geändert" },
    });
    expect(patch.status).toBe(409);
    expect((await body<ErrorPayload>(patch)).error.code).toBe("transaction_generated");

    const del = await call(`/api/households/${householdId}/finance/transactions/${id}`, { method: "DELETE", cookie: owner.cookie });
    expect(del.status).toBe(409);
    expect((await body<ErrorPayload>(del)).error.code).toBe("transaction_generated");
  });

  test("PATCH on a manual row works, including replace-all tags", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Bearbeiten");
    const created = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions`, {
        method: "POST",
        cookie: owner.cookie,
        body: { kind: "MINE_SPLIT", amountCents: 100, description: "Original", tags: ["eins", "zwei"] },
      }),
    );

    const patched = await call(`/api/households/${householdId}/finance/transactions/${created.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { description: "Geändert", tags: ["drei"] },
    });
    expect(patched.status).toBe(200);
    const payload = await body<TransactionResponse>(patched);
    expect(payload.description).toBe("Geändert");
    expect(payload.tags.map((t) => t.name)).toEqual(["drei"]);

    // Omitting `tags` entirely leaves them untouched (replace-all-when-present).
    const untouched = await call(`/api/households/${householdId}/finance/transactions/${created.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { amountCents: 200 },
    });
    const untouchedPayload = await body<TransactionResponse>(untouched);
    expect(untouchedPayload.tags.map((t) => t.name)).toEqual(["drei"]);
    expect(untouchedPayload.amountCents).toBe(200);
  });

  test("DELETE removes a manual row", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Löschen");
    const created = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions`, {
        method: "POST",
        cookie: owner.cookie,
        body: { kind: "MINE_SPLIT", amountCents: 100, description: "Weg" },
      }),
    );
    const deleted = await call(`/api/households/${householdId}/finance/transactions/${created.id}`, { method: "DELETE", cookie: owner.cookie });
    expect(deleted.status).toBe(204);
    const gone = await call(`/api/households/${householdId}/finance/transactions/${created.id}`, { cookie: owner.cookie });
    expect(gone.status).toBe(404);
  });
});

describe("GET /api/households/:householdId/finance/transactions — filters and pagination", () => {
  test("q, categoryId, tagIds (AND), pagination and sort", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Filter");
    const category = await body<{ id: string }>(
      await call(`/api/households/${householdId}/finance/categories`, { method: "POST", cookie: owner.cookie, body: { label: "Tierbedarf" } }),
    );

    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "Fressnapf Amazon", categoryId: category.id, tags: ["tiere", "amazon"] },
    });
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 200, description: "Katzenstreu", categoryId: category.id, tags: ["tiere"] },
    });
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 300, description: "Kino" },
    });

    const byQ = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?q=amazon`, { cookie: owner.cookie }),
    );
    expect(byQ.items).toHaveLength(1);
    expect(byQ.items[0]?.description).toBe("Fressnapf Amazon");

    const byCategory = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?categoryId=${category.id}`, { cookie: owner.cookie }),
    );
    expect(byCategory.total).toBe(2);

    const tagList = await body<{ items: { id: string; name: string }[] }>(
      await call(`/api/households/${householdId}/finance/tags`, { cookie: owner.cookie }),
    );
    const tiereId = tagList.items.find((t) => t.name === "tiere")!.id;
    const amazonId = tagList.items.find((t) => t.name === "amazon")!.id;

    const byBothTags = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?tagIds=${tiereId},${amazonId}`, { cookie: owner.cookie }),
    );
    expect(byBothTags.items).toHaveLength(1);
    expect(byBothTags.items[0]?.description).toBe("Fressnapf Amazon");

    const byTiereOnly = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?tagIds=${tiereId}`, { cookie: owner.cookie }),
    );
    expect(byTiereOnly.total).toBe(2);

    const page1 = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?limit=2&offset=0&sort=amount`, { cookie: owner.cookie }),
    );
    expect(page1.total).toBe(3);
    expect(page1.items.map((t) => t.amountCents)).toEqual([100, 200]);

    const page2 = await body<TransactionListResponse>(
      await call(`/api/households/${householdId}/finance/transactions?limit=2&offset=2&sort=amount`, { cookie: owner.cookie }),
    );
    expect(page2.items.map((t) => t.amountCents)).toEqual([300]);
  });
});

describe("GET /api/households/:householdId/finance/transactions/summary", () => {
  test("aggregates spend by category and month, excluding settlements", async () => {
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Zusammenfassung");
    await joinAsSecondMember(owner, householdId, partner);

    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 1000, description: "Ausgabe 1" },
    });
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "FOR_THEM", amountCents: 500, description: "Ausgabe 2" },
    });
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "TRANSFER", amountCents: 300, description: "Ausgleich" },
    });

    const summary = await body<TransactionSummaryResponse>(
      await call(`/api/households/${householdId}/finance/transactions/summary`, { cookie: owner.cookie }),
    );
    expect(summary.totalExpenseCents).toBe(1500);
    expect(summary.settlementTotalCents).toBe(300); // raw amountCents, unsigned by payer direction
    const uncategorized = summary.byCategory.find((c) => c.categoryId === null);
    expect(uncategorized?.totalCents).toBe(1500);
    expect(uncategorized?.count).toBe(2);
  });
});
