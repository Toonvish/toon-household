/**
 * Integration tests for /api/households/:householdId/finance/tags: normalization on
 * attach (a tag is only ever created as a side effect of tagging a
 * transaction — there is no POST /tags), rename conflicts, and delete.
 */
import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { body, call, createHousehold, createUser } from "./support/finance-harness.ts";

await runMigrations(db);

interface TagResponse {
  id: string;
  name: string;
  usageCount: number;
}
interface TagListResponse {
  items: TagResponse[];
}
interface TransactionResponse {
  id: string;
  tags: { id: string; name: string }[];
}
interface ErrorPayload {
  error: { code: string; message: string };
}

describe("tags as a side effect of tagging a transaction", () => {
  test("case/whitespace-insensitive: 'Amazon' and ' amazon ' merge into one tag", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Tags");

    const first = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 500, description: "Erste", tags: ["Amazon"] },
    });
    expect(first.status).toBe(201);

    const second = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 700, description: "Zweite", tags: [" amazon ", "Katzen"] },
    });
    expect(second.status).toBe(201);
    const secondPayload = await body<TransactionResponse>(second);
    expect(secondPayload.tags.map((t) => t.name).sort()).toEqual(["Katzen", "amazon"]);

    const list = await body<TagListResponse>(await call(`/api/households/${householdId}/finance/tags`, { cookie: owner.cookie }));
    const amazon = list.items.find((t) => t.name.toLowerCase() === "amazon")!;
    expect(amazon.usageCount).toBe(2);
    expect(list.items.find((t) => t.name === "Katzen")?.usageCount).toBe(1);
  });

  test("prefix search via ?q=", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Suche");
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "x", tags: ["Urlaub2024"] },
    });

    const found = await body<TagListResponse>(await call(`/api/households/${householdId}/finance/tags?q=urla`, { cookie: owner.cookie }));
    expect(found.items.map((t) => t.name)).toEqual(["Urlaub2024"]);

    const notFound = await body<TagListResponse>(await call(`/api/households/${householdId}/finance/tags?q=zzz`, { cookie: owner.cookie }));
    expect(notFound.items).toHaveLength(0);
  });
});

describe("PATCH /api/households/:householdId/finance/tags/:tagId", () => {
  test("renames a tag, and refuses a name that collides with another tag", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Umbenennen");
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "a", tags: ["eins"] },
    });
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "b", tags: ["zwei"] },
    });
    const list = await body<TagListResponse>(await call(`/api/households/${householdId}/finance/tags`, { cookie: owner.cookie }));
    const eins = list.items.find((t) => t.name === "eins")!;
    const zwei = list.items.find((t) => t.name === "zwei")!;

    const renamed = await call(`/api/households/${householdId}/finance/tags/${eins.id}`, { method: "PATCH", cookie: owner.cookie, body: { name: "drei" } });
    expect(renamed.status).toBe(200);
    expect((await body<TagResponse>(renamed)).name).toBe("drei");

    const clash = await call(`/api/households/${householdId}/finance/tags/${zwei.id}`, { method: "PATCH", cookie: owner.cookie, body: { name: "drei" } });
    expect(clash.status).toBe(409);
    expect((await body<ErrorPayload>(clash)).error.code).toBe("tag_name_taken");
  });
});

describe("DELETE /api/households/:householdId/finance/tags/:tagId", () => {
  test("drops the tag link but leaves the transaction itself untouched", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Löschen");
    const created = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "a", tags: ["weg"] },
    });
    const transaction = await body<TransactionResponse>(created);
    const list = await body<TagListResponse>(await call(`/api/households/${householdId}/finance/tags`, { cookie: owner.cookie }));
    const tag = list.items.find((t) => t.name === "weg")!;

    const deleted = await call(`/api/households/${householdId}/finance/tags/${tag.id}`, { method: "DELETE", cookie: owner.cookie });
    expect(deleted.status).toBe(204);

    const after = await body<TransactionResponse>(
      await call(`/api/households/${householdId}/finance/transactions/${transaction.id}`, { cookie: owner.cookie }),
    );
    expect(after.tags).toHaveLength(0);
  });
});
