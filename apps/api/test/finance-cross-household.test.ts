/**
 * The cross-household sweep of the finance module (SPEC D8, plan M3 decision 3 and task T09).
 *
 * User U owns household A, user V owns household B; both have finance enabled (the harness's
 * finance-ready `createHousehold`) and B holds one of everything that has an id: a
 * transaction with a tag, a custom category, a fixed-cost item and an income. With U's cookie,
 * EVERY by-id route under `/api/households/A/finance/…` is addressed with B's ids and must
 * answer `404 not_found` (never 200, never 403, never an empty 204): the household comes from
 * `:householdId` only and every lookup filters by it. U's own rows are the parents where a
 * route has one (a category delete with `reassignTo` = B's category, a transaction create or
 * edit with B's `categoryId`). One more probe is a participants PUT naming B's owner, which is
 * a 422 (not a member of A), not a 404.
 *
 * A coverage test reads the router files and fails when a declared `:param` route has no
 * probe, so a route added later cannot silently skip the sweep. The finance routers have no
 * route this sweep leaves out: the by-id routes are the transaction, category, tag, item and
 * income ones.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  financeCategories,
  financeFixedCostItems,
  financeIncomes,
  financeTags,
  financeTransactions,
} from "../src/modules/finance/schema.ts";
import { body, call, createHousehold, createUser, type TestUser } from "./support/finance-harness.ts";

await runMigrations(db);

interface Side {
  owner: TestUser;
  householdId: string;
  transactionId: string;
  categoryId: string;
  tagId: string;
  itemId: string;
  incomeId: string;
  personIds: string[];
}

const PERIOD = "2026-01";

async function expectOk<T>(response: Response, status: number): Promise<T> {
  if (response.status !== status) throw new Error(`setup failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** One of everything with an id, created through the API. */
async function seedSide(label: string): Promise<Side> {
  const owner = await createUser(`${label}owner`);
  const householdId = await createHousehold(owner, `${label} ${crypto.randomUUID().slice(0, 8)}`);
  const base = `/api/households/${householdId}/finance`;
  const as = { cookie: owner.cookie };

  const participants = await expectOk<{ items: { userId: string }[] }>(await call(`${base}/participants`, as), 200);
  const personIds = participants.items.map((item) => item.userId);

  const category = await expectOk<{ id: string }>(
    await call(`${base}/categories`, { method: "POST", ...as, body: { label: `Eigene ${label}` } }),
    201,
  );
  const transaction = await expectOk<{ id: string }>(
    await call(`${base}/transactions`, {
      method: "POST",
      ...as,
      body: {
        kind: "MINE_SPLIT",
        amountCents: 4_200,
        description: `Einkauf ${label}`,
        categoryId: category.id,
        tags: [`Tag ${label}`],
      },
    }),
    201,
  );
  const tags = await expectOk<{ items: { id: string }[] }>(await call(`${base}/tags`, as), 200);
  const tagId = tags.items[0]?.id;
  if (tagId === undefined) throw new Error("the seeded transaction produced no tag");
  const item = await expectOk<{ id: string }>(
    await call(`${base}/plan/items`, {
      method: "POST",
      ...as,
      body: { label: `Miete ${label}`, amountCents: 90_000, activeFrom: PERIOD },
    }),
    201,
  );
  const income = await expectOk<{ id: string }>(
    await call(`${base}/plan/incomes`, {
      method: "POST",
      ...as,
      body: { personId: owner.id, amountCents: 300_000, validFrom: PERIOD },
    }),
    201,
  );
  return {
    owner,
    householdId,
    transactionId: transaction.id,
    categoryId: category.id,
    tagId,
    itemId: item.id,
    incomeId: income.id,
    personIds,
  };
}

interface Probe {
  label: string;
  method: string;
  /** Under `/api/households/A/finance`, may carry a query. */
  path: string;
  body?: unknown;
  status: number;
  code: string;
}

let a: Side;
let b: Side;
/** A's own category carrying one of A's own transactions (parent of the reassign probe). */
let ownCategoryId = "";
let ownTransactionId = "";

beforeAll(async () => {
  a = await seedSide("A");
  b = await seedSide("B");
  const base = `/api/households/${a.householdId}/finance`;
  const as = { cookie: a.owner.cookie };
  ownCategoryId = (await expectOk<{ id: string }>(
    await call(`${base}/categories`, { method: "POST", ...as, body: { label: "Eigene A zwei" } }),
    201,
  )).id;
  ownTransactionId = (await expectOk<{ id: string }>(
    await call(`${base}/transactions`, {
      method: "POST",
      ...as,
      body: { kind: "MINE_SPLIT", amountCents: 1_000, description: "Eigener Einkauf", categoryId: ownCategoryId },
    }),
    201,
  )).id;
});

function probes(): Probe[] {
  const notFound = { status: 404, code: "not_found" } as const;
  return [
    { label: "GET transaction", method: "GET", path: `/transactions/${b.transactionId}`, ...notFound },
    { label: "PATCH transaction", method: "PATCH", path: `/transactions/${b.transactionId}`, body: { description: "gehackt" }, ...notFound },
    { label: "DELETE transaction", method: "DELETE", path: `/transactions/${b.transactionId}`, ...notFound },
    { label: "PATCH category", method: "PATCH", path: `/categories/${b.categoryId}`, body: { label: "gehackt" }, ...notFound },
    { label: "DELETE category", method: "DELETE", path: `/categories/${b.categoryId}`, ...notFound },
    {
      label: "DELETE own category reassigning to B's category",
      method: "DELETE",
      path: `/categories/${ownCategoryId}?reassignTo=${b.categoryId}`,
      ...notFound,
    },
    { label: "PATCH tag", method: "PATCH", path: `/tags/${b.tagId}`, body: { name: "gehackt" }, ...notFound },
    { label: "DELETE tag", method: "DELETE", path: `/tags/${b.tagId}`, ...notFound },
    { label: "PATCH item", method: "PATCH", path: `/plan/items/${b.itemId}`, body: { label: "gehackt" }, ...notFound },
    { label: "DELETE item", method: "DELETE", path: `/plan/items/${b.itemId}`, ...notFound },
    { label: "PATCH income", method: "PATCH", path: `/plan/incomes/${b.incomeId}`, body: { amountCents: 1 }, ...notFound },
    { label: "DELETE income", method: "DELETE", path: `/plan/incomes/${b.incomeId}`, ...notFound },
    {
      label: "POST transaction with B's categoryId",
      method: "POST",
      path: "/transactions",
      body: { kind: "MINE_SPLIT", amountCents: 500, description: "Fremde Kategorie", categoryId: b.categoryId },
      ...notFound,
    },
    {
      label: "PATCH own transaction to B's categoryId",
      method: "PATCH",
      path: `/transactions/${ownTransactionId}`,
      body: { categoryId: b.categoryId },
      ...notFound,
    },
    {
      label: "PUT participants naming B's owner",
      method: "PUT",
      path: "/participants",
      body: {
        participants: [
          { userId: a.owner.id, memberSlot: 1 },
          { userId: b.owner.id, memberSlot: 2 },
        ],
      },
      status: 422,
      code: "finance_participants_required",
    },
  ];
}

async function send(probe: Probe, cookie: string): Promise<Response> {
  return call(`/api/households/${a.householdId}/finance${probe.path}`, {
    method: probe.method,
    cookie,
    body: probe.body,
  });
}

/** Everything of B's that a refused request could have touched, by value. */
async function snapshotOfB(): Promise<unknown> {
  const where = <T extends { householdId: unknown }>(table: T) => eq(table.householdId as never, b.householdId);
  return {
    transactions: await db.select().from(financeTransactions).where(where(financeTransactions)),
    categories: await db.select().from(financeCategories).where(where(financeCategories)),
    tags: await db.select().from(financeTags).where(where(financeTags)),
    items: await db.select().from(financeFixedCostItems).where(where(financeFixedCostItems)),
    incomes: await db.select().from(financeIncomes).where(where(financeIncomes)),
  };
}

describe("finance cross-household sweep (SPEC D8)", () => {
  test("every by-id route answers the guard's status with the other household's ids", async () => {
    const results: { route: string; status: number; code: string | undefined }[] = [];
    for (const probe of probes()) {
      const response = await send(probe, a.owner.cookie);
      const payload = await body<{ error?: { code: string } }>(response);
      results.push({ route: probe.label, status: response.status, code: payload.error?.code });
    }
    expect(results).toEqual(probes().map((probe) => ({ route: probe.label, status: probe.status, code: probe.code })));
  });

  test("the refused requests changed nothing of B", async () => {
    const before = await snapshotOfB();
    for (const probe of probes()) await send(probe, a.owner.cookie);
    expect(await snapshotOfB()).toEqual(before);

    // B still reads its own rows through the API, under its own names.
    const base = `/api/households/${b.householdId}/finance`;
    const transaction = await body<{ description: string; categoryId: string | null }>(
      await call(`${base}/transactions/${b.transactionId}`, { cookie: b.owner.cookie }),
    );
    expect(transaction.description).toBe("Einkauf B");
    expect(transaction.categoryId).toBe(b.categoryId);
    const category = (await db.select().from(financeCategories).where(eq(financeCategories.id, b.categoryId)))[0];
    expect(category?.customLabel).toBe("Eigene B");
  });

  test("A's own rows keep their category after the refused reassign and edit", async () => {
    const rows = await db.select().from(financeTransactions).where(eq(financeTransactions.id, ownTransactionId));
    expect(rows[0]?.categoryId).toBe(ownCategoryId);
    const category = await db.select().from(financeCategories).where(eq(financeCategories.id, ownCategoryId));
    expect(category).toHaveLength(1);
  });

  test("a foreign cookie gets the same answer from the other side (B addressing A's ids)", async () => {
    const response = await call(
      `/api/households/${b.householdId}/finance/transactions/${a.transactionId}`,
      { cookie: b.owner.cookie },
    );
    expect(response.status).toBe(404);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("not_found");
  });

  test("covers every declared :param route of the finance routers", async () => {
    const routesDir = join(import.meta.dir, "..", "src", "modules", "finance", "routes");
    const files = (await readdir(routesDir)).filter((name) => name.endsWith(".ts") && name !== "index.ts");
    const sources = await Promise.all(files.map((name) => Bun.file(join(routesDir, name)).text()));
    const declared = sources
      .flatMap((text) =>
        [...text.matchAll(/Routes\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map(
          (match) => `${(match[1] ?? "").toUpperCase()} ${match[2] ?? ""}`,
        ),
      )
      .filter((route) => route.includes(":"));

    const all = probes();
    const swept = (route: string): boolean => {
      const [method, pattern] = route.split(" ") as [string, string];
      const shape = new RegExp(`^${pattern.replace(/:[A-Za-z]+/g, "[^/?]+").replace(/\//g, "\\/")}$`);
      return all.some((probe) => {
        if (probe.method !== method) return false;
        // The router mount is the first path segment (`/transactions`, `/plan`, ...).
        const segments = probe.path.split("?")[0]!.split("/").filter(Boolean);
        return shape.test(`/${segments.slice(1).join("/")}`);
      });
    };
    expect(declared.filter((route) => !swept(route))).toEqual([]);
    // transaction x3, category x2, tag x2, item x2, income x2.
    expect(declared.length).toBeGreaterThanOrEqual(11);
  });
});
