/**
 * Integration tests for /api/households/:householdId/finance/settlements:
 * `expectedBalanceCents` staleness, the derived payer, full/partial payment,
 * and idempotent replay.
 */
import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { body, call, createHousehold, createUser, joinAsSecondMember, type TestUser } from "./support/finance-harness.ts";

await runMigrations(db);

interface ErrorPayload {
  error: { code: string; message: string; details?: { currentBalanceCents?: number } };
}
interface BalanceResponse {
  balanceCents: number;
}
interface SettlementResponse {
  transaction: { id: string; payerId: string; splitMode: string; amountCents: number };
  balance: BalanceResponse;
}

async function currentBalance(owner: TestUser, householdId: string): Promise<number> {
  const payload = await body<BalanceResponse>(await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie }));
  return payload.balanceCents;
}

describe("POST /api/households/:householdId/finance/settlements", () => {
  test("409 balance_stale when expectedBalanceCents no longer matches", async () => {
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Veraltet");
    await joinAsSecondMember(owner, householdId, partner);

    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "FOR_THEM", amountCents: 10_000, description: "Für Partner" },
    });

    const stale = await call(`/api/households/${householdId}/finance/settlements`, {
      method: "POST",
      cookie: owner.cookie,
      body: { expectedBalanceCents: 0 },
    });
    expect(stale.status).toBe(409);
    const errorPayload = await body<ErrorPayload>(stale);
    expect(errorPayload.error.code).toBe("balance_stale");
    expect(errorPayload.error.details?.currentBalanceCents).toBe(10_000);
  });

  test("full settlement zeroes the balance; the debtor (slot 2) is the payer", async () => {
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Vollständig");
    await joinAsSecondMember(owner, householdId, partner);

    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "FOR_THEM", amountCents: 9_842, description: "Für Partner" },
    });
    const balance = await currentBalance(owner, householdId);
    expect(balance).toBe(9_842);

    const settle = await call(`/api/households/${householdId}/finance/settlements`, {
      method: "POST",
      cookie: owner.cookie,
      body: { expectedBalanceCents: balance },
    });
    expect(settle.status).toBe(201);
    const payload = await body<SettlementResponse>(settle);
    expect(payload.transaction.payerId).toBe(partner.id);
    expect(payload.transaction.splitMode).toBe("SETTLEMENT");
    expect(payload.transaction.amountCents).toBe(9_842);
    expect(payload.balance.balanceCents).toBe(0);
  });

  test("a partial settlement leaves the remainder open", async () => {
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Teilweise");
    await joinAsSecondMember(owner, householdId, partner);

    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "FOR_THEM", amountCents: 9_842, description: "Für Partner" },
    });

    const settle = await call(`/api/households/${householdId}/finance/settlements`, {
      method: "POST",
      cookie: owner.cookie,
      body: { expectedBalanceCents: 9_842, amountCents: 5_000 },
    });
    expect(settle.status).toBe(201);
    expect((await body<SettlementResponse>(settle)).balance.balanceCents).toBe(4_842);
  });

  test("a replayed mutationId does not book twice", async () => {
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Replay");
    await joinAsSecondMember(owner, householdId, partner);
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "FOR_THEM", amountCents: 1_000, description: "Für Partner" },
    });

    const mutationId = crypto.randomUUID();
    const first = await call(`/api/households/${householdId}/finance/settlements`, {
      method: "POST",
      cookie: owner.cookie,
      body: { expectedBalanceCents: 1_000, mutationId },
    });
    expect(first.status).toBe(201);

    const second = await call(`/api/households/${householdId}/finance/settlements`, {
      method: "POST",
      cookie: owner.cookie,
      body: { expectedBalanceCents: 1_000, mutationId },
    });
    expect(second.status).toBe(200);
    expect((await body<SettlementResponse>(second)).transaction.id).toBe((await body<SettlementResponse>(first)).transaction.id);

    const list = await body<{ total: number }>(await call(`/api/households/${householdId}/finance/settlements`, { cookie: owner.cookie }));
    expect(list.total).toBe(1);
  });

  test("amountCents <= 0 is rejected", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "UngültigerBetrag");
    const response = await call(`/api/households/${householdId}/finance/settlements`, {
      method: "POST",
      cookie: owner.cookie,
      body: { expectedBalanceCents: 0, amountCents: -5 },
    });
    expect(response.status).toBe(422);
  });
});
