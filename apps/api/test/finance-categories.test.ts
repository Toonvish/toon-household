/**
 * Integration tests for /api/households/:householdId/finance/categories: the 21
 * seeded defaults + locale-rendered labels, custom category CRUD, the system
 * category's protections, and delete-with-reassign.
 */
import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { body, call, createHousehold, createUser } from "./support/finance-harness.ts";

await runMigrations(db);

interface ErrorPayload {
  error: { code: string; message: string };
}
interface CategoryResponse {
  id: string;
  slug: string;
  label: string;
  customLabel: string | null;
  isSystem: boolean;
  isHidden: boolean;
  position: number;
  usageCount: number;
}
interface CategoryListResponse {
  items: CategoryResponse[];
}
interface TransactionResponse {
  id: string;
  categoryId: string | null;
}

describe("GET /api/households/:householdId/finance/categories", () => {
  test("returns all 21 defaults, labelled from the catalog in the negotiated locale", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Kategorien");

    const de = await call(`/api/households/${householdId}/finance/categories`, { cookie: owner.cookie });
    expect(de.status).toBe(200);
    const dePayload = await body<CategoryListResponse>(de);
    expect(dePayload.items).toHaveLength(21);
    expect(dePayload.items.find((c) => c.slug === "tiere")?.label).toBe("Tiere");
    expect(dePayload.items.find((c) => c.slug === "fixkosten")?.isSystem).toBe(true);
    // Sorted by position.
    expect(dePayload.items[0]?.slug).toBe("tiere");

    const en = await call(`/api/households/${householdId}/finance/categories`, {
      cookie: owner.cookie,
      headers: { "Accept-Language": "en" },
    });
    const enPayload = await body<CategoryListResponse>(en);
    expect(enPayload.items.find((c) => c.slug === "tiere")?.label).toBe("Pets");
  });
});

describe("POST /api/households/:householdId/finance/categories", () => {
  test("creates a custom category with a custom-prefixed slug", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Neu");

    const response = await call(`/api/households/${householdId}/finance/categories`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Basteln" },
    });
    expect(response.status).toBe(201);
    const category = await body<CategoryResponse>(response);
    expect(category.slug.startsWith("custom-")).toBe(true);
    expect(category.label).toBe("Basteln");
    expect(category.customLabel).toBe("Basteln");
    expect(category.isSystem).toBe(false);
  });
});

describe("PATCH /api/households/:householdId/finance/categories/:categoryId", () => {
  test("renames a custom category, but refuses to rename the system category", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Umbenennen");

    const created = await call(`/api/households/${householdId}/finance/categories`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Alt" },
    });
    const category = await body<CategoryResponse>(created);

    const renamed = await call(`/api/households/${householdId}/finance/categories/${category.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { label: "Neu" },
    });
    expect(renamed.status).toBe(200);
    expect((await body<CategoryResponse>(renamed)).label).toBe("Neu");

    const categories = await body<CategoryListResponse>(
      await call(`/api/households/${householdId}/finance/categories`, { cookie: owner.cookie }),
    );
    const fixkosten = categories.items.find((c) => c.slug === "fixkosten")!;

    const blocked = await call(`/api/households/${householdId}/finance/categories/${fixkosten.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { label: "Umbenannt" },
    });
    expect(blocked.status).toBe(409);
    expect((await body<ErrorPayload>(blocked)).error.code).toBe("category_system");

    // isHidden may still change on the system category.
    const hide = await call(`/api/households/${householdId}/finance/categories/${fixkosten.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { isHidden: true },
    });
    expect(hide.status).toBe(200);
  });
});

describe("DELETE /api/households/:householdId/finance/categories/:categoryId", () => {
  test("refuses to delete the system category", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "System löschen");
    const categories = await body<CategoryListResponse>(
      await call(`/api/households/${householdId}/finance/categories`, { cookie: owner.cookie }),
    );
    const fixkosten = categories.items.find((c) => c.slug === "fixkosten")!;

    const response = await call(`/api/households/${householdId}/finance/categories/${fixkosten.id}`, { method: "DELETE", cookie: owner.cookie });
    expect(response.status).toBe(409);
    expect((await body<ErrorPayload>(response)).error.code).toBe("category_system");
  });

  test("409 category_in_use without reassignTo, then reassigns and deletes", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Umhängen");

    const created = await call(`/api/households/${householdId}/finance/categories`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Alte Kategorie" },
    });
    const oldCategory = await body<CategoryResponse>(created);
    const target = await call(`/api/households/${householdId}/finance/categories`, {
      method: "POST",
      cookie: owner.cookie,
      body: { label: "Zielkategorie" },
    });
    const newCategory = await body<CategoryResponse>(target);

    const tx = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 1234, description: "Test", categoryId: oldCategory.id },
    });
    expect(tx.status).toBe(201);
    const transaction = await body<TransactionResponse>(tx);

    const blocked = await call(`/api/households/${householdId}/finance/categories/${oldCategory.id}`, { method: "DELETE", cookie: owner.cookie });
    expect(blocked.status).toBe(409);
    expect((await body<ErrorPayload>(blocked)).error.code).toBe("category_in_use");

    const reassigned = await call(`/api/households/${householdId}/finance/categories/${oldCategory.id}?reassignTo=${newCategory.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(reassigned.status).toBe(204);

    const after = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions/${transaction.id}`, { cookie: owner.cookie }),
    );
    expect(after.categoryId).toBe(newCategory.id);
  });
});
