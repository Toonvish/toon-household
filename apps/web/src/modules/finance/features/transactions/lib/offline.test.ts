/**
 * The optimistic cache patches behind the offline mutation defaults.
 *
 * These handlers run while the server is unreachable and the mutation is
 * PAUSED, so whatever they write to the cache is what the user sees — possibly
 * for hours, across a cold start, with no response coming to correct it. Two
 * failure modes matter and neither raises anything: a row inserted into a list
 * it does not belong to, and a row removed by a delete the server then
 * refused. Both look exactly like success.
 *
 * The registered handlers are exercised directly (`getMutationDefaults`), so
 * the assertions are about the real `onMutate`/`onError`/`onSuccess` the
 * replay path uses, not a re-implementation of them.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import type { TransactionResponse } from "@toon/shared";
import { queryKeys } from "@/modules/finance/lib/queries";
import {
  registerTransactionMutationDefaults,
  TX_MUTATION_KEYS,
  type CreateTransactionVariables,
  type DeleteTransactionVariables,
} from "./offline";

const HOUSEHOLD = "hh-1";
const VIEWER = "user-1";
const OTHER = "user-2";

interface ListPage {
  items: TransactionResponse[];
  total: number;
  limit: number;
  offset: number;
}

/** The subset of a registered mutation default this test drives. */
interface Handlers<V> {
  onMutate?: (variables: V) => Promise<unknown> | unknown;
  onError?: (error: Error, variables: V, context: unknown) => Promise<unknown> | unknown;
  onSuccess?: (data: unknown, variables: V, context: unknown) => Promise<unknown> | unknown;
}

function handlersFor<V>(client: QueryClient, key: readonly unknown[]): Handlers<V> {
  return client.getMutationDefaults(key as string[]) as Handlers<V>;
}

function row(id: string): TransactionResponse {
  return {
    id,
    householdId: HOUSEHOLD,
    payerId: VIEWER,
    splitMode: "SPLIT_EQUAL",
    amountCents: 1000,
    description: id,
    categoryId: null,
    categorySlug: null,
    tags: [],
    bookedAt: "2026-01-01T00:00:00.000Z",
    dateSource: "exact",
    origin: "manual",
    planPeriod: null,
    createdBy: VIEWER,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    otherShareCents: 500,
    payerShareCents: 500,
    balanceDeltaCents: 500,
    isExpense: true,
  };
}

function page(items: TransactionResponse[], offset = 0): ListPage {
  return { items, total: items.length, limit: 50, offset };
}

function freshClient(): QueryClient {
  const client = new QueryClient();
  registerTransactionMutationDefaults(client);
  return client;
}

describe("the DELETE default", () => {
  test("puts the row back when the server refuses the delete", async () => {
    const client = freshClient();
    const listKey = queryKeys.transactions(HOUSEHOLD, { limit: 50 });
    client.setQueryData(listKey, page([row("a"), row("b"), row("c")]));

    const handlers = handlersFor<DeleteTransactionVariables>(client, TX_MUTATION_KEYS.remove);
    const variables: DeleteTransactionVariables = { householdId: HOUSEHOLD, transactionId: "b", mutationId: "m1" };

    const context = await handlers.onMutate?.(variables);
    expect(client.getQueryData<ListPage>(listKey)?.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(client.getQueryData<ListPage>(listKey)?.total).toBe(2);

    // A plan-generated row answers `409 transaction_generated`, and
    // `shouldRetry` never retries a 4xx — so this is the everyday path.
    await handlers.onError?.(new Error("transaction_generated"), variables, context);
    expect(client.getQueryData<ListPage>(listKey)?.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(client.getQueryData<ListPage>(listKey)?.total).toBe(3);
  });

  test("drops the deleted row's detail cache instead of leaving it readable", async () => {
    const client = freshClient();
    const detailKey = queryKeys.transaction(HOUSEHOLD, "b");
    client.setQueryData(detailKey, row("b"));

    const handlers = handlersFor<DeleteTransactionVariables>(client, TX_MUTATION_KEYS.remove);
    await handlers.onSuccess?.(undefined, { householdId: HOUSEHOLD, transactionId: "b", mutationId: "m1" }, undefined);

    // Left in cache it would render on /transactions/b for STALE_TIME.detail
    // as if the row still existed.
    expect(client.getQueryData(detailKey)).toBeUndefined();
  });
});

describe("the CREATE default's optimistic row", () => {
  const variables: CreateTransactionVariables = {
    householdId: HOUSEHOLD,
    mutationId: "m2",
    kind: "MINE_SPLIT",
    amountCents: 2000,
    description: "Neu",
    optimistic: { viewerId: VIEWER, otherId: OTHER },
  };

  test("lands on the unfiltered first page", async () => {
    const client = freshClient();
    const listKey = queryKeys.transactions(HOUSEHOLD, { limit: 50 });
    client.setQueryData(listKey, page([row("a")]));

    await handlersFor<CreateTransactionVariables>(client, TX_MUTATION_KEYS.create).onMutate?.(variables);

    const items = client.getQueryData<ListPage>(listKey)?.items ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("optimistic:m2");
  });

  test("stays out of lists whose filter it cannot evaluate", async () => {
    const client = freshClient();
    const byCategory = queryKeys.transactions(HOUSEHOLD, { categoryId: "cat-1" });
    const byRange = queryKeys.transactions(HOUSEHOLD, { from: "2026-01-01", to: "2026-01-31" });
    const secondPage = queryKeys.transactions(HOUSEHOLD, { limit: 50, offset: 50 });
    client.setQueryData(byCategory, page([row("a")]));
    client.setQueryData(byRange, page([row("a")]));
    client.setQueryData(secondPage, page([row("a")], 50));

    await handlersFor<CreateTransactionVariables>(client, TX_MUTATION_KEYS.create).onMutate?.(variables);

    // A prefix-wide patch would prepend the row to all three: a category it is
    // not in, a month it did not happen in, and page 2 of a list it belongs at
    // the top of. Offline the mutation is paused, so nothing corrects that.
    for (const key of [byCategory, byRange, secondPage]) {
      expect(client.getQueryData<ListPage>(key)?.items.map((item) => item.id)).toEqual(["a"]);
    }
  });

  test("is removed again from every list when the write fails", async () => {
    const client = freshClient();
    const listKey = queryKeys.transactions(HOUSEHOLD, { limit: 50 });
    client.setQueryData(listKey, page([row("a")]));

    const handlers = handlersFor<CreateTransactionVariables>(client, TX_MUTATION_KEYS.create);
    const context = await handlers.onMutate?.(variables);
    await handlers.onError?.(new Error("validation_failed"), variables, context);

    expect(client.getQueryData<ListPage>(listKey)?.items.map((item) => item.id)).toEqual(["a"]);
    expect(client.getQueryData<ListPage>(listKey)?.total).toBe(1);
  });
});
