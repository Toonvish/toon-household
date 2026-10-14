/**
 * The invalidation fan-out after a ledger write.
 *
 * `invalidateAfterLedgerMutation` is the ONE place that answers "what does a
 * booking touch", and every consumer trusts it instead of listing keys itself.
 * That makes a forgotten key invisible: nothing fails, the screen just keeps
 * showing yesterday's number. The trap is that the key layout LOOKS
 * hierarchical — `"transactions"`, `"transaction-summary"`, `"balance"`,
 * `"balance-history"` all sit under the same household prefix — but TanStack
 * matches per array ELEMENT, so `"transactions"` is not a prefix of
 * `"transaction-summary"` and never invalidates it.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { invalidateAfterLedgerMutation, queryKeys } from "./queries";

const HOUSEHOLD = "hh-1";

/** A client whose queries are all inactive (no observers), so invalidation never refetches. */
function seededClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(queryKeys.transactions(HOUSEHOLD, { limit: 50 }), { items: [], total: 0, limit: 50, offset: 0 });
  client.setQueryData(queryKeys.transactionSummary(HOUSEHOLD, { from: "2026-01-01" }), { byCategory: [], byMonth: [] });
  client.setQueryData(queryKeys.balance(HOUSEHOLD), { balanceCents: 0 });
  client.setQueryData(queryKeys.balanceHistory(HOUSEHOLD), { items: [] });
  client.setQueryData(queryKeys.settlements(HOUSEHOLD), { items: [], total: 0 });
  client.setQueryData(queryKeys.categories(HOUSEHOLD), { items: [] });
  client.setQueryData(queryKeys.tags(HOUSEHOLD), { items: [] });
  client.setQueryData(queryKeys.plan(HOUSEHOLD), { items: [] });
  client.setQueryData(queryKeys.householdMembers(HOUSEHOLD), { items: [] });
  return client;
}

const invalidated = (client: QueryClient, key: readonly unknown[]): boolean =>
  client.getQueryState(key)?.isInvalidated === true;

describe("invalidateAfterLedgerMutation", () => {
  test("invalidates every read a booking changes, including the ones on their own key segment", async () => {
    const client = seededClient();
    await invalidateAfterLedgerMutation(client, HOUSEHOLD);

    expect(invalidated(client, queryKeys.transactions(HOUSEHOLD, { limit: 50 }))).toBe(true);
    // The dashboard cards. Missed by a `"transactions"` prefix — the bug this pins.
    expect(invalidated(client, queryKeys.transactionSummary(HOUSEHOLD, { from: "2026-01-01" }))).toBe(true);
    expect(invalidated(client, queryKeys.balance(HOUSEHOLD))).toBe(true);
    // Likewise: `"balance"` is not a prefix of `"balance-history"`.
    expect(invalidated(client, queryKeys.balanceHistory(HOUSEHOLD))).toBe(true);
    // A settlement IS a transaction, and `useCreateSettlement` funnels through here.
    expect(invalidated(client, queryKeys.settlements(HOUSEHOLD))).toBe(true);
    expect(invalidated(client, queryKeys.categories(HOUSEHOLD))).toBe(true);
    expect(invalidated(client, queryKeys.tags(HOUSEHOLD))).toBe(true);
  });

  test("leaves reads a booking does not change alone", async () => {
    const client = seededClient();
    await invalidateAfterLedgerMutation(client, HOUSEHOLD);

    // The fixed-cost plan setup and the member list are unaffected by one
    // booking; invalidating the whole household prefix instead would be a
    // cheap way to be "correct" and a needless refetch storm on every tap.
    expect(invalidated(client, queryKeys.plan(HOUSEHOLD))).toBe(false);
    expect(invalidated(client, queryKeys.householdMembers(HOUSEHOLD))).toBe(false);
  });

  test("does not reach into another household", async () => {
    const client = seededClient();
    client.setQueryData(queryKeys.balance("hh-2"), { balanceCents: 0 });
    await invalidateAfterLedgerMutation(client, HOUSEHOLD);
    expect(invalidated(client, queryKeys.balance("hh-2"))).toBe(false);
  });
});
