/**
 * Path-segment encoding in the finance fetchers (toon-finance 1715207, security review): every id goes
 * through `seg()`, so a `/` or `?` in an id stays inside ONE segment. Driven against a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  deleteTransaction,
  fetchBalance,
  fetchTransaction,
  renameParticipant,
  updateFixedCostItem,
  updateMyFinanceDisplayName,
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
