/**
 * The recipe client on `RecipeApi` (plan docs/plans/e6-web-client.md E6-T04, P7, P7a, P8, P14): one path per
 * resource family, ids interpolated RAW (behaviour frozen, unlike the core client's `seg()`), a decoded
 * response, a READ that fails with `invalid_response` and a shopping WRITE whose mismatching response resolves
 * the raw payload. Driven against a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runPromise } from "@/lib/runtime";
import {
  addShoppingItems,
  checkShoppingItem,
  createCard,
  createTag,
  deleteCollection,
  fetchCards,
  fetchCollection,
  fetchPlanRange,
  fetchRecipe,
  fetchRecipes,
  fetchShoppingBoughtHistory,
  fetchShoppingCatalogPage,
  fetchShoppingList,
  fetchTags,
  importFromText,
  RecipeApi,
  uploadRecipeImage,
} from "./api";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: string | null; headers: Headers }> = [];
let respond: () => Response;

function answer(body: unknown, status = 200): void {
  respond = () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  respond = () => new Response(null, { status: 204 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
      headers: new Headers(init?.headers),
    });
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Path and query of a recorded call, without the API origin. */
function pathOf(index = 0): string {
  const call = calls[index];
  if (!call) throw new Error("no request recorded");
  const url = new URL(call.url);
  return url.pathname + url.search;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

const H = "11111111-1111-4111-8111-111111111111";
const L = "33333333-3333-4333-8333-333333333333";

const tag = {
  id: "44444444-4444-4444-8444-444444444444",
  householdId: H,
  name: "Pasta",
  kind: "free" as const,
  color: null,
  createdAt: "2026-10-16T08:00:00.000Z",
  recipeCount: 3,
};

describe("one path per resource family (byte for byte)", () => {
  test("recipes: the query string, with hasCooked as the string 1 or 0", async () => {
    await fetchRecipes(H, { q: "suppe", maxMinutes: 30, hasCooked: false, limit: 20, offset: 40 });
    expect(pathOf()).toBe(`/api/households/${H}/recipe/recipes?q=suppe&maxMinutes=30&hasCooked=0&limit=20&offset=40`);
    expect(calls[0]?.method).toBe("GET");
    await fetchRecipes(H);
    expect(pathOf(1)).toBe(`/api/households/${H}/recipe/recipes`);
  });

  test("tags: a POST carries the JSON body", async () => {
    answer({ tag }, 201);
    await createTag(H, { name: "Pasta", kind: "free" });
    expect(pathOf()).toBe(`/api/households/${H}/recipe/tags`);
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ name: "Pasta", kind: "free" });
    expect(calls[0]?.headers.get("content-type")).toContain("application/json");
  });

  test("collections: a DELETE answering 204 resolves undefined", async () => {
    expect(await deleteCollection(H, "c1")).toBeUndefined();
    expect(pathOf()).toBe(`/api/households/${H}/recipe/collections/c1`);
    expect(calls[0]?.method).toBe("DELETE");
  });

  test("collections: a membership PUT", async () => {
    await runPromise(RecipeApi.addRecipeToCollection(H, "c1", "r1"));
    expect(pathOf()).toBe(`/api/households/${H}/recipe/collections/c1/recipes/r1`);
    expect(calls[0]?.method).toBe("PUT");
  });

  test("plan: the range query", async () => {
    await fetchPlanRange(H, { from: "2026-11-02", to: "2026-11-08" });
    expect(pathOf()).toBe(`/api/households/${H}/recipe/plan?from=2026-11-02&to=2026-11-08`);
  });

  test("imports: a text import is a JSON POST", async () => {
    await importFromText(H, { text: "Suppe" } as never);
    expect(pathOf()).toBe(`/api/households/${H}/recipe/imports/text`);
    expect(calls[0]?.method).toBe("POST");
  });

  test("shopping: list, items, check, catalog page and bought history", async () => {
    await fetchShoppingList(H, L);
    await addShoppingItems(H, L, { items: [] } as never);
    await checkShoppingItem(H, L, "i1", { mutationId: "m1" } as never);
    await fetchShoppingCatalogPage(H, L, { includeHidden: true, limit: 5 });
    await fetchShoppingBoughtHistory(H, { listId: L, offset: 10 });
    expect(calls.map((c) => `${c.method} ${pathOf(calls.indexOf(c))}`)).toEqual([
      `GET /api/households/${H}/recipe/shopping-lists/${L}`,
      `POST /api/households/${H}/recipe/shopping-lists/${L}/items`,
      `POST /api/households/${H}/recipe/shopping-lists/${L}/items/i1/check`,
      `GET /api/households/${H}/recipe/shopping-lists/${L}/catalog?includeHidden=1&limit=5`,
      `GET /api/households/${H}/recipe/shopping-lists/bought?listId=${L}&offset=10`,
    ]);
  });

  test("cards: the user-scoped path has no household", async () => {
    await fetchCards();
    await createCard({ name: "dm", code: "123", format: "ean13" } as never);
    expect(pathOf(0)).toBe("/api/recipe/cards");
    expect(`${calls[1]?.method} ${pathOf(1)}`).toBe("POST /api/recipe/cards");
  });

  test("an upload is a multipart POST; over 15 MB it REJECTS with payload_too_large (D2)", async () => {
    answer({ url: "/uploads/x.png" }, 201);
    const small = new File([new Uint8Array(4)], "p.png", { type: "image/png" });
    await uploadRecipeImage(H, "r1", small);
    expect(pathOf()).toBe(`/api/households/${H}/recipe/recipes/r1/image`);
    expect(calls[0]?.method).toBe("POST");
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const error = await rejectionOf(uploadRecipeImage(H, "r1", big));
    expect(error).toMatchObject({ code: "payload_too_large" });
    expect(calls).toHaveLength(1);
  });
});

describe("ids are interpolated raw, never seg()", () => {
  test("an id with a slash stays in the path as typed", async () => {
    await fetchRecipe(H, "a/b");
    expect(pathOf()).toBe(`/api/households/${H}/recipe/recipes/a/b`);
    await fetchCollection(H, "x/y/z");
    expect(pathOf(1)).toBe(`/api/households/${H}/recipe/collections/x/y/z`);
  });
});

describe("responses are decoded (P7, P7a)", () => {
  test("a matching READ resolves the wire value", async () => {
    answer({ items: [tag] });
    expect(await fetchTags(H)).toEqual({ items: [tag] });
  });

  test("a READ whose body does not match fails with invalid_response and the 2xx status", async () => {
    answer({ items: [{ ...tag, kind: "nope" }] });
    const error = await rejectionOf(fetchTags(H));
    expect(error).toMatchObject({ _tag: "ApiError", code: "invalid_response", status: 200 });
  });

  test("a READ with an empty cards body fails the same way", async () => {
    answer({ cards: [] });
    expect(await rejectionOf(fetchCards())).toMatchObject({ code: "invalid_response" });
  });

  test("a shopping WRITE whose response mismatches resolves the raw payload (the server applied it)", async () => {
    const payload = { unexpected: "shape" };
    answer(payload);
    expect(await checkShoppingItem(H, L, "i1", { mutationId: "m1" } as never)).toEqual(payload as never);
  });
});
