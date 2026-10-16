import { gen, uniqueIds, variants, type Case } from "./_lib.ts";
import { BOOL_INPUTS } from "./finance.common.ts";
import { BALANCE, ID, TS } from "./_fixtures.ts";

const BREAKDOWN = BALANCE.breakdown;
const POINT = { period: "2026-10", deltaCents: -250, balanceCents: 1000 };

export const cases: Case[] = uniqueIds([
  ...gen("BalanceBreakdownSchema", BREAKDOWN, {
    mode: "full",
    extra: {
      "negative-cents": { ...BREAKDOWN, splitOtherCents: -5 },
      "fraction-cents": { ...BREAKDOWN, forOtherCents: 0.5 },
      "count-negative": { ...BREAKDOWN, transactionCount: -1 },
      "count-fraction": { ...BREAKDOWN, transactionCount: 1.5 },
      "count-max-safe": { ...BREAKDOWN, transactionCount: 9007199254740991 },
      "count-over-max-safe": { ...BREAKDOWN, transactionCount: 9007199254740992 },
      "all-bad": { splitOtherCents: "1", forOtherCents: null, settledCents: [], transactionCount: "x" },
    },
  }),
  ...gen("BalanceResponseSchema", BALANCE, {
    depth: 1,
    extra: {
      "breakdown-bad": { ...BALANCE, breakdown: { ...BREAKDOWN, transactionCount: -1 } },
      "breakdown-empty": { ...BALANCE, breakdown: {} },
      "ids-bad": { ...BALANCE, perspectiveUserId: "x", viewerUserId: 1 },
      "as-of-bad": { ...BALANCE, asOf: "2026-10-16" },
    },
  }),
  ...gen("BalanceQuerySchema", { includeAggregates: "1" }, {
    mode: "full",
    minimal: {},
    extra: { "unknown-key": { includeAggregates: "0", foo: "bar" } },
  }),
  ...variants("BalanceQuerySchema", {}, "agg-", BOOL_INPUTS.map((value) => ["includeAggregates", value] as const)),
  ...gen("BalanceHistoryQuerySchema", { from: "2026-01", to: "2026-12", includeAggregates: "true" }, {
    mode: "full",
    minimal: {},
    lens: { from: [1, 100], to: [1, 100] },
    extra: {
      "from-undefined": { from: undefined, to: undefined },
      "from-empty": { from: "", to: "" },
      "reversed": { from: "2026-12", to: "2026-01" },
      "dates": { from: "2026-01-01", to: "2026-12-31" },
      "unknown-key": { includeAggregates: "false", sort: "asc" },
    },
  }),
  ...variants("BalanceHistoryQuerySchema", {}, "agg-", BOOL_INPUTS.map((value) => ["includeAggregates", value] as const)),
  ...gen("BalanceHistoryPointSchema", POINT, {
    mode: "full",
    extra: {
      "period-low": { ...POINT, period: "1999-12" },
      "period-high": { ...POINT, period: "2101-01" },
      "period-format": { ...POINT, period: "2026-13" },
      "fraction": { ...POINT, deltaCents: 0.5 },
      "all-bad": { period: "x", deltaCents: "1", balanceCents: null },
    },
  }),
  ...gen("BalanceHistoryResponseSchema", { items: [POINT] }, {
    mode: "light",
    minimal: { items: [] },
    extra: { "two": { items: [POINT, { ...POINT, period: "2026-11" }] }, "second-bad": { items: [POINT, { period: "x" }] }, "uuid-misplaced": { items: [{ id: ID, at: TS }] } },
  }),
]);
