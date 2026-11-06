/**
 * E6-T03 (docs/plans/e6-web-client.md P7, P7c): the contract test of the finance routes the web
 * client decodes. A household with finance enabled and two participants is driven through the REAL
 * app (`app.request`, the finance harness, the shared test `db`, ADR 0009); every JSON route of
 * `apps/web/src/modules/finance/lib/api.ts` has a row, and each row asserts the status the client
 * expects, that `Schema.decodeUnknownSync(schema, { disableChecks: true })(body)` succeeds AND that
 * the decoded value `toEqual`s the body (nothing stripped, defaulted or transformed: P7's identity
 * oracle with the web's decode options).
 *
 * A row the oracle cannot satisfy without breaking `packages/shared/test` carries
 * `lenient: { schema: "<XResponseSchema>", reason: "<one line>" }` ON ONE LINE (P7c) and keeps the
 * assertion that the body is the wire truth; E6-T05 applies those rows in the finance client.
 *
 * The harness gives toon-finance's names H semantics (docs/modules/finance.md): `createHousehold` is
 * finance-ready (owner in slot 1, a hidden Partner in slot 2), `joinAsSecondMember` re-seats slot 2
 * (ADR 0004). A second household seats a placeholder member (ADR 0006) for the rename routes.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AccrualRunListResponseSchema,
  BalanceHistoryResponseSchema,
  BalanceResponseSchema,
  CategoryListResponseSchema,
  CategoryResponseSchema,
  FinanceParticipantListResponseSchema,
  FinanceParticipantResponseSchema,
  FinanceTagListResponseSchema,
  FinanceTagResponseSchema,
  FixedCostItemResponseSchema,
  IncomeResponseSchema,
  PlanComputationResponseSchema,
  PlanResponseSchema,
  RecalculatePlanResponseSchema,
  RunPlanResponseSchema,
  SettlementResponseSchema,
  TransactionListResponseSchema,
  TransactionResponseSchema,
  TransactionSummaryResponseSchema,
} from "@toon/shared";
import { db } from "../src/db/client.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { setClockForTest } from "../src/modules/finance/lib/clock.ts";
import {
  addPlaceholder,
  call,
  createHousehold,
  createPlainHousehold,
  createUser,
  enableFinance,
  joinAsSecondMember,
  type TestUser,
} from "./support/finance-harness.ts";

await runMigrations(db);

afterAll(() => setClockForTest(null));

const OPTIONS = { disableChecks: true } as const;

interface Row {
  name: string;
  method?: string;
  path: string;
  body?: unknown;
  status?: number;
  schema: Schema.Top;
  /** P7c: ON ONE LINE; the schema the client passes as `lenient(...)` and why. */
  lenient?: { schema: string; reason: string };
}

const rows: string[] = [];
const lenientRows: string[] = [];

/** Runs one row as the given user: status, decode with the web's options, identity. Returns the body. */
async function check(user: TestUser, row: Row): Promise<any> {
  const response = await call(row.path, { method: row.method ?? "GET", cookie: user.cookie, body: row.body });
  const text = await response.text();
  expect(response.status, `${row.name}: ${row.method ?? "GET"} ${row.path} -> ${text}`).toBe(row.status ?? 200);
  const payload = JSON.parse(text) as unknown;
  rows.push(row.name);
  if (row.lenient) {
    lenientRows.push(`${row.name} (${row.lenient.schema}): ${row.lenient.reason}`);
    return payload;
  }
  const decoded = Schema.decodeUnknownSync(row.schema as Schema.Decoder<unknown>, OPTIONS)(payload);
  expect(decoded, `${row.name}: decoded is not the body`).toEqual(payload);
  return payload;
}

const JAN = Date.UTC(2026, 0, 15, 12);

describe("finance contract: the routes the web client decodes", () => {
  test("every JSON route of the finance client decodes to the body", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const partner = await createUser("Partner");
    const householdId = await createHousehold(owner, "Vertrag");
    await joinAsSecondMember(owner, householdId, partner);
    const base = `/api/households/${householdId}/finance`;

    // participants
    const participants = await check(owner, { name: "fetchFinanceParticipants", path: `${base}/participants`, schema: FinanceParticipantListResponseSchema });
    expect(participants.items).toHaveLength(2);
    await check(owner, {
      name: "updateFinanceParticipants",
      method: "PUT",
      path: `${base}/participants`,
      body: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: partner.id, memberSlot: 2 }] },
      schema: FinanceParticipantListResponseSchema,
    });
    await check(partner, {
      name: "updateMyFinanceDisplayName",
      method: "PATCH",
      path: `${base}/participants/me`,
      body: { displayName: "Pat" },
      schema: FinanceParticipantResponseSchema,
    });

    // categories
    const categories = await check(owner, { name: "fetchCategories", path: `${base}/categories`, schema: CategoryListResponseSchema });
    expect(categories.items.length).toBeGreaterThan(0);
    const created = await check(owner, {
      name: "createCategory",
      method: "POST",
      path: `${base}/categories`,
      body: { label: "Vertrags-Kategorie" },
      status: 201,
      schema: CategoryResponseSchema,
    });
    await check(owner, {
      name: "updateCategory",
      method: "PATCH",
      path: `${base}/categories/${created.id}`,
      body: { label: "Umbenannt", isHidden: true },
      schema: CategoryResponseSchema,
    });
    const system = categories.items.find((c: { isSystem: boolean }) => c.isSystem);
    await check(owner, {
      name: "updateCategory (system)",
      method: "PATCH",
      path: `${base}/categories/${system.id}`,
      body: { isHidden: true },
      schema: CategoryResponseSchema,
    });
    const withHidden = await check(owner, { name: "fetchCategories (includeHidden)", path: `${base}/categories?includeHidden=true`, schema: CategoryListResponseSchema });
    expect(withHidden.items.length).toBeGreaterThan(categories.items.length - 1);
    await check(owner, {
      name: "updateCategory (unhide)",
      method: "PATCH",
      path: `${base}/categories/${system.id}`,
      body: { isHidden: false },
      schema: CategoryResponseSchema,
    });

    // transactions
    const mutationId = crypto.randomUUID();
    const tx = await check(owner, {
      name: "createTransaction",
      method: "POST",
      path: `${base}/transactions`,
      body: { kind: "MINE_SPLIT", amountCents: 12_345, description: "Wocheneinkauf", categoryId: system.id, tags: ["Wochenmarkt", "bio"], mutationId },
      status: 201,
      schema: TransactionResponseSchema,
    });
    await check(owner, {
      name: "createTransaction (FOR_THEM, no category)",
      method: "POST",
      path: `${base}/transactions`,
      body: { kind: "FOR_THEM", amountCents: 5_000, description: "Für Partner", bookedAt: "2026-01-10T10:00:00.000Z" },
      status: 201,
      schema: TransactionResponseSchema,
    });
    await check(partner, {
      name: "createTransaction (THEIRS_SPLIT, partner)",
      method: "POST",
      path: `${base}/transactions`,
      body: { kind: "THEIRS_SPLIT", amountCents: 2_000, description: "Vom Partner" },
      status: 201,
      schema: TransactionResponseSchema,
    });
    await check(owner, {
      name: "createTransaction (Sammelbuchung tag)",
      method: "POST",
      path: `${base}/transactions`,
      body: { kind: "MINE_SPLIT", amountCents: 999, description: "Sammelbuchung Test", tags: ["sammelbuchung"] },
      status: 201,
      schema: TransactionResponseSchema,
    });
    const list = await check(owner, { name: "fetchTransactions", path: `${base}/transactions`, schema: TransactionListResponseSchema });
    expect(list.items.length).toBeGreaterThanOrEqual(4);
    const listNoAgg = await check(owner, {
      name: "fetchTransactions (includeAggregates=false, filters)",
      path: `${base}/transactions?includeAggregates=false&sort=-amount&limit=10&offset=0&q=kauf&from=2026-01&to=2026-01`,
      schema: TransactionListResponseSchema,
    });
    expect(listNoAgg.items.length).toBeGreaterThan(0);
    await check(owner, { name: "fetchTransaction", path: `${base}/transactions/${tx.id}`, schema: TransactionResponseSchema });
    await check(owner, {
      name: "updateTransaction (mutationId)",
      method: "PATCH",
      path: `${base}/transactions/${tx.id}`,
      body: { description: "Wocheneinkauf (geändert)", tags: ["bio"], mutationId: crypto.randomUUID() },
      schema: TransactionResponseSchema,
    });
    await check(owner, { name: "fetchTransactionSummary", path: `${base}/transactions/summary`, schema: TransactionSummaryResponseSchema });
    await check(owner, {
      name: "fetchTransactionSummary (range, includeAggregates=false)",
      path: `${base}/transactions/summary?from=2026-01&to=2026-01&includeAggregates=false`,
      schema: TransactionSummaryResponseSchema,
    });

    // tags
    const tags = await check(owner, { name: "fetchTags", path: `${base}/tags`, schema: FinanceTagListResponseSchema });
    expect(tags.items.length).toBeGreaterThan(0);
    await check(owner, { name: "fetchTags (q, limit)", path: `${base}/tags?q=bi&limit=5`, schema: FinanceTagListResponseSchema });
    await check(owner, {
      name: "updateTag",
      method: "PATCH",
      path: `${base}/tags/${tags.items[0].id}`,
      body: { name: "umbenannt" },
      schema: FinanceTagResponseSchema,
    });

    // balance
    await check(owner, { name: "fetchBalance", path: `${base}/balance`, schema: BalanceResponseSchema });
    const balance = await check(partner, { name: "fetchBalance (includeAggregates=false)", path: `${base}/balance?includeAggregates=false`, schema: BalanceResponseSchema });
    await check(owner, { name: "fetchBalanceHistory", path: `${base}/balance/history`, schema: BalanceHistoryResponseSchema });
    const history = await check(owner, {
      name: "fetchBalanceHistory (range)",
      path: `${base}/balance/history?from=2026-01&to=2026-03&includeAggregates=false`,
      schema: BalanceHistoryResponseSchema,
    });
    expect(history.items.length).toBeGreaterThan(0);

    // plan
    await check(owner, { name: "fetchPlan (empty)", path: `${base}/plan`, schema: PlanResponseSchema });
    const item = await check(owner, {
      name: "createFixedCostItem",
      method: "POST",
      path: `${base}/plan/items`,
      body: { label: "Fixkosten Gesamt", amountCents: 118_750, activeFrom: "2026-01" },
      status: 201,
      schema: FixedCostItemResponseSchema,
    });
    await check(owner, {
      name: "updateFixedCostItem",
      method: "PATCH",
      path: `${base}/plan/items/${item.id}`,
      body: { label: "Fixkosten", activeTo: null },
      schema: FixedCostItemResponseSchema,
    });
    const income1 = await check(owner, {
      name: "createIncome",
      method: "POST",
      path: `${base}/plan/incomes`,
      body: { personId: owner.id, amountCents: 301_745, validFrom: "2026-01" },
      status: 201,
      schema: IncomeResponseSchema,
    });
    await check(owner, {
      name: "createIncome (partner)",
      method: "POST",
      path: `${base}/plan/incomes`,
      body: { personId: partner.id, amountCents: 198_255, validFrom: "2026-01" },
      status: 201,
      schema: IncomeResponseSchema,
    });
    await check(owner, {
      name: "updateIncome",
      method: "PATCH",
      path: `${base}/plan/incomes/${income1.id}`,
      body: { amountCents: 301_746 },
      schema: IncomeResponseSchema,
    });
    await check(owner, { name: "fetchPlanPreview", path: `${base}/plan/preview?period=2026-01`, schema: PlanComputationResponseSchema });
    await check(owner, {
      name: "updatePlan",
      method: "PATCH",
      path: `${base}/plan`,
      body: { enabled: true, payerId: owner.id, startPeriod: "2026-01" },
      schema: PlanResponseSchema,
    });
    await check(owner, { name: "fetchPlan (enabled)", path: `${base}/plan`, schema: PlanResponseSchema });
    await check(owner, { name: "runPlan", method: "POST", path: `${base}/plan/run`, body: { through: "2026-01" }, schema: RunPlanResponseSchema });
    await check(owner, { name: "runPlan (nothing pending)", method: "POST", path: `${base}/plan/run`, body: {}, schema: RunPlanResponseSchema });
    await check(owner, { name: "fetchPlan (after run)", path: `${base}/plan`, schema: PlanResponseSchema });
    await check(owner, { name: "fetchPlanRuns", path: `${base}/plan/runs?limit=10&offset=0`, schema: AccrualRunListResponseSchema });
    await check(owner, {
      name: "updateFixedCostItem (amount)",
      method: "PATCH",
      path: `${base}/plan/items/${item.id}`,
      body: { amountCents: 120_000 },
      schema: FixedCostItemResponseSchema,
    });
    const dry = await check(owner, {
      name: "recalculatePlan (dryRun)",
      method: "POST",
      path: `${base}/plan/recalculate`,
      body: { dryRun: true },
      schema: RecalculatePlanResponseSchema,
    });
    expect(dry.items.length).toBeGreaterThan(0);
    const applied = await check(owner, {
      name: "recalculatePlan (apply)",
      method: "POST",
      path: `${base}/plan/recalculate`,
      body: { dryRun: false },
      schema: RecalculatePlanResponseSchema,
    });
    expect(applied.adjustments.length).toBeGreaterThan(0);

    // settlements
    const current = await check(owner, { name: "fetchBalance (pre-settlement)", path: `${base}/balance`, schema: BalanceResponseSchema });
    expect(balance.viewerUserId).toBe(partner.id);
    const settlement = await check(owner, {
      name: "createSettlement",
      method: "POST",
      path: `${base}/settlements`,
      body: { expectedBalanceCents: current.balanceCents, note: "Ausgleich", mutationId: crypto.randomUUID() },
      status: 201,
      schema: SettlementResponseSchema,
    });
    expect(settlement.transaction.splitMode).toBe("SETTLEMENT");
    const settlements = await check(owner, { name: "fetchSettlements", path: `${base}/settlements?limit=20&offset=0`, schema: TransactionListResponseSchema });
    expect(settlements.items.length).toBeGreaterThan(0);
  });

  test("a placeholder seat: participants list and rename decode to the body (ADR 0006)", async () => {
    setClockForTest(JAN);
    const owner = await createUser("Owner");
    const householdId = await createPlainHousehold(owner, "Platzhalter");
    const placeholderId = await addPlaceholder(owner, householdId, "Oma");
    const enabled = await enableFinance(owner, householdId, owner, { id: placeholderId } as TestUser);
    expect(enabled.status).toBe(200);
    const base = `/api/households/${householdId}/finance`;
    const list = await check(owner, { name: "fetchFinanceParticipants (placeholder)", path: `${base}/participants`, schema: FinanceParticipantListResponseSchema });
    expect(list.items.some((p: { hasAccount: boolean; email: unknown }) => !p.hasAccount && p.email === null)).toBe(true);
    await check(owner, {
      name: "renameParticipant",
      method: "PATCH",
      path: `${base}/participants/${placeholderId}`,
      body: { displayName: "Omi" },
      schema: FinanceParticipantResponseSchema,
    });
    await check(owner, {
      name: "createTransaction (placeholder household)",
      method: "POST",
      path: `${base}/transactions`,
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "Brötchen" },
      status: 201,
      schema: TransactionResponseSchema,
    });
    await check(owner, { name: "fetchBalance (placeholder)", path: `${base}/balance`, schema: BalanceResponseSchema });
  });

  test("the rows cover every JSON export of the finance client", async () => {
    const source = await Bun.file(new URL("../../web/src/modules/finance/lib/api.ts", import.meta.url)).text();
    const all = [...source.matchAll(/export function (\w+)\([\s\S]*?\):\s*Promise<(\w+)>/g)];
    const jsonExports = all.filter((m) => m[2] !== "void").map((m) => m[1]!);
    // 33 exports at the time of writing (the plan said 34), five of them void deletes: 28 JSON routes.
    expect(all.length).toBe(33);
    expect(jsonExports.length).toBe(28);
    const covered = rows.join("\n");
    for (const fn of jsonExports) {
      expect(covered, `no contract row for ${fn}`).toContain(fn);
    }
    console.log(`[web-contract-finance] ${rows.length} rows, ${lenientRows.length} lenient${lenientRows.length ? `: ${lenientRows.join("; ")}` : ""}`);
  });
});
