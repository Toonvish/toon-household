import { describe, expect, test } from "bun:test";
import {
  BalanceResponseSchema,
  BooleanQuerySchema,
  CreateSettlementRequestSchema,
  CreateTransactionRequestSchema,
  ERROR_CODES,
  FinanceDisplayNameSchema,
  FinanceParticipantAssignmentSchema,
  FinancePaginationQuerySchema as PaginationQuerySchema,
  MAX_PERIOD,
  MIN_PERIOD,
  PeriodSchema,
  PlanResponseSchema,
  PositiveCentsSchema,
  TagQuerySchema,
  TransactionListQuerySchema,
  TransactionResponseSchema,
  TxKindSchema,
  listResponse,
} from "../src/index.ts";
import { z } from "zod";

test("ERROR_CODES is the exact, stable wire contract from docs/spec.md §3.2", () => {
  expect(ERROR_CODES).toContain("transaction_amount_zero");
  expect(ERROR_CODES).toContain("plan_period_out_of_range");
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length); // no duplicates
  // M3 decision 8: the core list also carries the finance codes, so F's exact length (30) and its
  // household_full expectation (not ported, no H code path throws it) are not pinned here.
});

/** The key `refineKey` stamps on a custom issue (`params.i18n`). */
function i18nKeyOf(issue: unknown): unknown {
  return (issue as { params?: { i18n?: string } } | undefined)?.params?.i18n;
}

describe("PeriodSchema", () => {
  test.each(["2026-01", "2026-12"])("%s parses", (value) => {
    expect(PeriodSchema.parse(value)).toBe(value);
  });

  test.each(["2026-13", "26-01", "2026-1", "not-a-period"])("%s is rejected", (value) => {
    expect(PeriodSchema.safeParse(value).success).toBe(false);
  });
});

describe("PeriodSchema bounds (toon-finance 1715207)", () => {
  test("MIN_PERIOD and MAX_PERIOD are the inclusive ends: 2000-01 and 2100-12", () => {
    expect([MIN_PERIOD, MAX_PERIOD]).toEqual(["2000-01", "2100-12"]);
    expect(PeriodSchema.parse(MIN_PERIOD)).toBe("2000-01");
    expect(PeriodSchema.parse(MAX_PERIOD)).toBe("2100-12");
  });

  test.each(["1999-12", "0001-01", "0000-01", "2101-01", "9999-12"])("%s is well-formed but out of bounds", (value) => {
    const result = PeriodSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(i18nKeyOf(result.error.issues[0])).toBe("server.validation.periodBounds");
  });

  test("a malformed period still reports the format key, not the bounds key", () => {
    const result = PeriodSchema.safeParse("2026-13");
    expect(result.success).toBe(false);
    if (!result.success) expect(i18nKeyOf(result.error.issues[0])).toBe("server.validation.periodFormat");
  });
});

describe("request bounds (toon-finance 1715207)", () => {
  const base = { kind: "MINE_SPLIT", amountCents: 100, description: "x" } as const;

  test("tags: at most 20 names per transaction", () => {
    const names = (count: number) => Array.from({ length: count }, (_, index) => `t${index}`);
    expect(CreateTransactionRequestSchema.safeParse({ ...base, tags: names(20) }).success).toBe(true);
    expect(CreateTransactionRequestSchema.safeParse({ ...base, tags: names(21) }).success).toBe(false);
  });

  test("list query: q at most 100 and tagIds at most 400 characters", () => {
    expect(TransactionListQuerySchema.safeParse({ q: "a".repeat(100) }).success).toBe(true);
    expect(TransactionListQuerySchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
    expect(TransactionListQuerySchema.safeParse({ tagIds: "a".repeat(400) }).success).toBe(true);
    expect(TransactionListQuerySchema.safeParse({ tagIds: "a".repeat(401) }).success).toBe(false);
  });

  test("tag autocomplete: q at most 100 characters", () => {
    expect(TagQuerySchema.safeParse({ q: "a".repeat(100) }).success).toBe(true);
    expect(TagQuerySchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
  });
});

describe("FinanceDisplayNameSchema (toon-finance 1715207: no control characters)", () => {
  test("trims, keeps umlauts, accepts 80 characters", () => {
    expect(FinanceDisplayNameSchema.parse("  Jürgen  ")).toBe("Jürgen");
    expect(FinanceDisplayNameSchema.safeParse("a".repeat(80)).success).toBe(true);
    expect(FinanceDisplayNameSchema.safeParse("a".repeat(81)).success).toBe(false);
    expect(FinanceDisplayNameSchema.safeParse("   ").success).toBe(false);
  });

  test.each(["Zeile\neins", "Tab\there", "Nul\u0000l", "Esc\u001b[0m", "Del\u007f"])(
    "%j is refused with server.validation.noControlChars",
    (value) => {
      const result = FinanceDisplayNameSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(i18nKeyOf(result.error.issues[0])).toBe("server.validation.noControlChars");
    },
  );
});

describe("CentsSchema variants", () => {
  test("PositiveCentsSchema rejects 0 and negatives", () => {
    expect(PositiveCentsSchema.safeParse(0).success).toBe(false);
    expect(PositiveCentsSchema.safeParse(-1).success).toBe(false);
    expect(PositiveCentsSchema.safeParse(1).success).toBe(true);
  });
});

describe("BooleanQuerySchema", () => {
  test("accepts real booleans", () => {
    expect(BooleanQuerySchema.parse(true)).toBe(true);
    expect(BooleanQuerySchema.parse(false)).toBe(false);
  });

  test('the STRING "false" parses to false, not true (the z.coerce.boolean() trap)', () => {
    expect(BooleanQuerySchema.parse("false")).toBe(false);
    expect(BooleanQuerySchema.parse("0")).toBe(false);
  });

  test('the STRING "true"/"1" parses to true', () => {
    expect(BooleanQuerySchema.parse("true")).toBe(true);
    expect(BooleanQuerySchema.parse("1")).toBe(true);
  });

  test("rejects garbage", () => {
    expect(BooleanQuerySchema.safeParse("yes").success).toBe(false);
  });
});

describe("PaginationQuerySchema", () => {
  test("defaults to limit 50, offset 0", () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  test("max limit is 200 (higher than toon-recipe's 100, docs/spec.md §8.2 #12)", () => {
    expect(PaginationQuerySchema.safeParse({ limit: 200 }).success).toBe(true);
    expect(PaginationQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  test("coerces string query values", () => {
    expect(PaginationQuerySchema.parse({ limit: "10", offset: "5" })).toEqual({ limit: 10, offset: 5 });
  });
});

test("listResponse() produces { items, total, limit, offset }", () => {
  const schema = listResponse(z.object({ id: z.string() }));
  const parsed = schema.parse({ items: [{ id: "a" }], total: 1, limit: 50, offset: 0 });
  expect(parsed.items).toEqual([{ id: "a" }]);
});

describe("TxKindSchema — exactly the four UI kinds", () => {
  test.each(["MINE_SPLIT", "THEIRS_SPLIT", "FOR_THEM", "TRANSFER"])("%s is valid", (kind) => {
    expect(TxKindSchema.safeParse(kind).success).toBe(true);
  });

  test("a fifth kind is rejected", () => {
    expect(TxKindSchema.safeParse("THEIRS_FOR_ME").success).toBe(false);
  });
});

describe("CreateTransactionRequestSchema", () => {
  test("a minimal valid request", () => {
    const parsed = CreateTransactionRequestSchema.parse({
      kind: "MINE_SPLIT",
      amountCents: 1_250,
      description: "Fressnapf",
    });
    expect(parsed.amountCents).toBe(1_250);
  });

  test("amountCents === 0 parses at the SCHEMA level (docs/spec.md §3.6's ban is enforced server-side)", () => {
    // Deliberately NOT rejected here: a Zod `.refine()` issue always surfaces as
    // the generic `422 validation_failed` (lib/errors.ts's `toApiError`), never
    // as the dedicated `transaction_amount_zero` the wire contract promises.
    // `createTransaction`/`updateTransaction` (apps/api/src/services/ledger/
    // transactions.service.ts) throw that code directly instead — see
    // apps/api/test/transactions.test.ts for the actual 422 assertion.
    expect(
      CreateTransactionRequestSchema.safeParse({ kind: "MINE_SPLIT", amountCents: 0, description: "x" }).success,
    ).toBe(true);
  });

  test("a negative amount is ACCEPTED (refunds/credits are meaningful, docs/spec.md §3.6)", () => {
    expect(
      CreateTransactionRequestSchema.safeParse({ kind: "FOR_THEM", amountCents: -3_147, description: "Erstattung" })
        .success,
    ).toBe(true);
  });

  test("an empty description is rejected", () => {
    expect(
      CreateTransactionRequestSchema.safeParse({ kind: "MINE_SPLIT", amountCents: 100, description: "" }).success,
    ).toBe(false);
  });
});

test("TransactionListQuerySchema defaults sort to -bookedAt and includeAggregates to true", () => {
  const parsed = TransactionListQuerySchema.parse({});
  expect(parsed.sort).toBe("-bookedAt");
  expect(parsed.includeAggregates).toBe(true);
  expect(parsed.limit).toBe(50);
});

test("TransactionResponseSchema round-trips a full row", () => {
  const row = {
    id: crypto.randomUUID(),
    householdId: crypto.randomUUID(),
    payerId: crypto.randomUUID(),
    splitMode: "OTHER_ONLY" as const,
    amountCents: 47_086,
    description: "Fixkostenanteil 09/2025",
    categoryId: crypto.randomUUID(),
    categorySlug: "fixkosten",
    tags: [{ id: crypto.randomUUID(), name: "fixkosten" }],
    bookedAt: new Date().toISOString(),
    dateSource: "exact" as const,
    origin: "fixed_plan" as const,
    planPeriod: "2025-09",
    createdBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    otherShareCents: 47_086,
    payerShareCents: 71_664,
    balanceDeltaCents: 47_086,
    isExpense: true,
  };
  expect(TransactionResponseSchema.parse(row)).toEqual(row);
});

test("BalanceResponseSchema shape", () => {
  const body = {
    balanceCents: 9_842,
    perspectiveUserId: crypto.randomUUID(),
    viewerUserId: crypto.randomUUID(),
    viewerBalanceCents: 9_842,
    asOf: new Date().toISOString(),
    breakdown: { splitOtherCents: 1_437_161, forOtherCents: 2_799_994, settledCents: -4_128_099, transactionCount: 310 },
  };
  expect(BalanceResponseSchema.parse(body)).toEqual(body);
});

test("CreateSettlementRequestSchema requires expectedBalanceCents and a positive optional amountCents", () => {
  expect(CreateSettlementRequestSchema.safeParse({ expectedBalanceCents: 9_842 }).success).toBe(true);
  expect(CreateSettlementRequestSchema.safeParse({}).success).toBe(false);
  expect(
    CreateSettlementRequestSchema.safeParse({ expectedBalanceCents: 9_842, amountCents: -1 }).success,
  ).toBe(false);
});

test("PlanResponseSchema allows current: null (plan_incomplete)", () => {
  const body = {
    plan: { enabled: false, payerId: crypto.randomUUID(), startPeriod: "2026-08", lastBookedPeriod: null },
    items: [],
    incomes: [],
    current: null,
    lastRun: null,
    pendingPeriods: [],
  };
  expect(PlanResponseSchema.parse(body)).toEqual(body);
});

// M3 decision 4 / 8: F's health case is replaced. HealthResponseSchema is the core's (core/schemas/common.ts),
// so the finance case pins the participants assignment contract instead: exactly two entries parse, one fails.
test("FinanceParticipantAssignmentSchema: two entries parse, one entry fails", () => {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  expect(
    FinanceParticipantAssignmentSchema.safeParse([
      { userId: first, memberSlot: 1 },
      { userId: second, memberSlot: 2 },
    ]).success,
  ).toBe(true);
  expect(FinanceParticipantAssignmentSchema.safeParse([{ userId: first, memberSlot: 1 }]).success).toBe(false);
});
