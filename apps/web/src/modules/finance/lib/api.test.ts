/**
 * Path-segment encoding in the finance fetchers (toon-finance 1715207, security review): every id goes
 * through `seg()`, so a `/` or `?` in an id stays inside ONE segment. Driven against a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TransactionResponse } from "@toon/shared";
import {
  createTransaction,
  deleteTransaction,
  fetchBalance,
  fetchTransaction,
  fetchTransactions,
  renameParticipant,
  updateFixedCostItem,
  updateMyFinanceDisplayName,
  isApiError,
} from "./api";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: string | null }> = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function pathOf(index = 0): string {
  const call = calls[index];
  if (!call) throw new Error("no request recorded");
  const url = new URL(call.url);
  return url.pathname + url.search;
}

describe("finance fetchers keep an id inside one path segment", () => {
  test("household and transaction ids", async () => {
    await fetchTransaction("h/1", "../x");
    await deleteTransaction("h/1", "t?1", "m1");
    expect(pathOf(0)).toBe("/api/households/h%2F1/finance/transactions/..%2Fx");
    expect(pathOf(1)).toBe("/api/households/h%2F1/finance/transactions/t%3F1?mutationId=m1");
  });

  test("a plan item and the balance", async () => {
    await updateFixedCostItem("h/1", "i/2", {});
    await fetchBalance("h/1");
    expect(pathOf(0)).toBe("/api/households/h%2F1/finance/plan/items/i%2F2");
    expect(pathOf(1)).toBe("/api/households/h%2F1/finance/balance");
  });

  test("the participants routes: own seat and the placeholder rename (ADR 0006)", async () => {
    await updateMyFinanceDisplayName("h/1", { displayName: "Ich" });
    await renameParticipant("h/1", "u/2", { displayName: "Pia B." });
    expect(calls[0]).toMatchObject({ method: "PATCH" });
    expect(pathOf(0)).toBe("/api/households/h%2F1/finance/participants/me");
    expect(calls[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ displayName: "Pia B." }) });
    expect(pathOf(1)).toBe("/api/households/h%2F1/finance/participants/u%2F2");
  });
});

/* -------------------------------------------------------------------------- */
/* E6-T05: the finance client on FinanceApi (plan docs/plans/e6-web-client.md P7, P7a, P14) */
/* -------------------------------------------------------------------------- */

const transaction: TransactionResponse = {
  id: "33333333-3333-4333-8333-333333333333",
  householdId: "11111111-1111-4111-8111-111111111111",
  payerId: "22222222-2222-4222-8222-222222222222",
  splitMode: "SPLIT_EQUAL",
  amountCents: 1250,
  description: "Einkauf",
  categoryId: null,
  categorySlug: null,
  tags: [{ id: "44444444-4444-4444-8444-444444444444", name: "Wocheneinkauf" }],
  bookedAt: "2026-01-15T12:00:00.000Z",
  dateSource: "exact",
  origin: "manual",
  planPeriod: null,
  createdBy: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-01-15T12:00:00.000Z",
  updatedAt: "2026-01-15T12:00:00.000Z",
  otherShareCents: 625,
  payerShareCents: 625,
  balanceDeltaCents: 625,
  isExpense: true,
};

/** Replaces the per-test 204 stub with one answer for every request, recording the calls too. */
function answerWith(body: unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("finance responses are decoded with the shared schema (P7, P7a)", () => {
  test("a READ round-trips a TransactionResponse to the wire value", async () => {
    answerWith(transaction);
    expect(await fetchTransaction("h1", transaction.id)).toEqual(transaction);
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(pathOf(0)).toBe(`/api/households/h1/finance/transactions/${transaction.id}`);
  });

  test("a list READ keeps the query string and decodes", async () => {
    answerWith({ items: [transaction], total: 1, limit: 50, offset: 0 });
    const list = await fetchTransactions("h1", { limit: 50, q: "Ein kauf" });
    expect(list.items).toEqual([transaction]);
    expect(pathOf(0)).toBe("/api/households/h1/finance/transactions?q=Ein+kauf&limit=50");
  });

  test("a READ whose body fails the decode is invalid_response with the 2xx status", async () => {
    answerWith({ ...transaction, amountCents: "12,50" });
    const error = await rejectionOf(fetchTransaction("h1", transaction.id));
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ _tag: "ApiError", code: "invalid_response", status: 200 });
    expect(typeof (error as { details: unknown }).details).toBe("string");
  });

  test("a READ that violates only the checks (an id that is no UUID) still decodes", async () => {
    const legacy = { ...transaction, id: "legacy-1", createdAt: "gestern" };
    answerWith(legacy);
    expect(await fetchTransaction("h1", "legacy-1")).toEqual(legacy);
  });

  test("a create WRITE whose response mismatches resolves the raw payload (the outbox replay, P7a)", async () => {
    const odd = { ...transaction, amountCents: "12,50", unexpected: true };
    answerWith(odd, 201);
    const created = await createTransaction("h1", { kind: "MINE_SPLIT", amountCents: 1250, description: "Einkauf" });
    expect(created as unknown).toEqual(odd);
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(pathOf(0)).toBe("/api/households/h1/finance/transactions");
  });

  test("a delete WRITE with a 204 resolves undefined and keeps ?mutationId=", async () => {
    await deleteTransaction("h1", "t1", "m-1");
    expect(pathOf(0)).toBe("/api/households/h1/finance/transactions/t1?mutationId=m-1");
  });
});
