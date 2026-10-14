/**
 * `module_disabled` handling (SPEC §5; plan m1-core §1 decision 9): any query or mutation
 * failing with that code invalidates `["toon","me"]`, so the refreshed
 * `households[].modules` lets `RequireModule` send the user Home. Other errors do not.
 */
import { describe, expect, test } from "bun:test";
import { ApiError } from "./api";
import { queryKeys } from "./queries";
import { createQueryClient, seedOnlineManager } from "./query-client";

const ME_DATA = { user: null, households: [], activeHouseholdId: null };

function seededClient() {
  const client = createQueryClient();
  client.setQueryData(queryKeys.me(), ME_DATA);
  expect(client.getQueryState(queryKeys.me())?.isInvalidated).toBe(false);
  return client;
}

function failingQuery(client: ReturnType<typeof createQueryClient>, code: string, status = 404) {
  return client
    .fetchQuery({
      queryKey: ["toon", "household", "h1", "recipe", "list"],
      queryFn: () => Promise.reject(new ApiError({ code, status, message: "x" })),
      retry: false,
    })
    .catch(() => undefined);
}

describe("createQueryClient — module_disabled", () => {
  test("a query failing with module_disabled invalidates ['toon','me']", async () => {
    const client = seededClient();
    await failingQuery(client, "module_disabled");
    expect(client.getQueryState(queryKeys.me())?.isInvalidated).toBe(true);
  });

  test("a query failing with another code leaves ['toon','me'] valid", async () => {
    const client = seededClient();
    await failingQuery(client, "not_found");
    await failingQuery(client, "forbidden", 403);
    expect(client.getQueryState(queryKeys.me())?.isInvalidated).toBe(false);
  });

  test("a non-ApiError leaves ['toon','me'] valid", async () => {
    const client = seededClient();
    await client
      .fetchQuery({
        queryKey: ["toon", "x"],
        queryFn: () => Promise.reject(new Error("module_disabled")),
        retry: false,
      })
      .catch(() => undefined);
    expect(client.getQueryState(queryKeys.me())?.isInvalidated).toBe(false);
  });

  test("a mutation failing with module_disabled invalidates ['toon','me']", async () => {
    const client = seededClient();
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError({ code: "module_disabled", status: 404, message: "x" })),
      })
      .execute(undefined)
      .catch(() => undefined);
    expect(client.getQueryState(queryKeys.me())?.isInvalidated).toBe(true);
  });

  test("a mutation failing with another code leaves ['toon','me'] valid", async () => {
    const client = seededClient();
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError({ code: "validation_error", status: 400, message: "x" })),
      })
      .execute(undefined)
      .catch(() => undefined);
    expect(client.getQueryState(queryKeys.me())?.isInvalidated).toBe(false);
  });
});

describe("seedOnlineManager", () => {
  test("a boot while the browser is offline marks the manager offline, so restored writes stay paused", () => {
    const calls: boolean[] = [];
    seedOnlineManager(false, { setOnline: (online) => void calls.push(online) });
    expect(calls).toEqual([false]);
  });

  test("an online or unknown boot leaves TanStack's default (online) alone", () => {
    const calls: boolean[] = [];
    seedOnlineManager(true, { setOnline: (online) => void calls.push(online) });
    seedOnlineManager(undefined, { setOnline: (online) => void calls.push(online) });
    expect(calls).toEqual([]);
  });
});
