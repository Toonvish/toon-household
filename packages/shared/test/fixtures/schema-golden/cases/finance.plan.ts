import { gen, singleKeys, uniqueIds, type Case } from "./_lib.ts";
import { ID, ID2, TS, TX } from "./_fixtures.ts";

const ITEM = { id: ID, label: "Miete", amountCents: 80000, activeFrom: "2026-01", activeTo: "2026-12", position: 1 };
const INCOME = { id: ID, personId: ID2, amountCents: 300000, validFrom: "2026-01", validTo: "2026-12" };
const COMPUTATION = {
  period: "2026-10",
  costTotalCents: 100000,
  incomeTotalCents: 500000,
  quoteNumerator: 1,
  quoteDenominator: 5,
  shares: [{ personId: ID, incomeCents: 300000, shareCents: 60000 }],
  payerId: ID,
  bookableCents: 100000,
  booked: false,
};
const RUN = { id: ID, trigger: "boot", fromPeriod: "2026-09", toPeriod: "2026-10", periodsBooked: 2, periodsSkipped: 0, bookedCents: 200000, error: null, startedAt: TS, finishedAt: TS };
const CREATE_ITEM = { label: "Miete", amountCents: 80000, activeFrom: "2026-01", activeTo: "2026-12", position: 1 };
const CREATE_INCOME = { personId: ID2, amountCents: 300000, validFrom: "2026-01", validTo: "2026-12" };
const RECALC_LINE = { period: "2026-09", bookedCents: 1000, recomputedCents: 1200, deltaCents: 200 };

const BAD_PERIODS = ["1999-12", "2101-01", "2026-13", "x", "2026-1"];

export const cases: Case[] = uniqueIds([
  ...gen("PlanPreviewQuerySchema", { period: "2026-10" }, {
    mode: "full",
    extra: Object.fromEntries(BAD_PERIODS.map((period) => [`period-${period}`, { period }])),
  }),
  ...gen("UpdatePlanRequestSchema", { enabled: true, payerId: ID, startPeriod: "2026-01" }, {
    mode: "full",
    extra: {
      empty: {},
      "unknown-only": { foo: 1 },
      "enabled-false": { enabled: false },
      "enabled-string": { enabled: "true" },
      "payer-bad": { payerId: "x" },
      "start-low": { startPeriod: "1999-12" },
      "start-high": { startPeriod: "2101-01" },
      "start-format": { startPeriod: "2026-13" },
      "all-bad": { enabled: 1, payerId: 1, startPeriod: 1 },
      "all-undefined": { enabled: undefined, payerId: undefined, startPeriod: undefined },
      "start-null": { startPeriod: null },
    },
  }),
  ...gen("FixedCostItemResponseSchema", ITEM, {
    allNull: { ...ITEM, activeTo: null },
    extra: {
      "amount-zero": { ...ITEM, amountCents: 0 },
      "amount-negative": { ...ITEM, amountCents: -1 },
      "amount-fraction": { ...ITEM, amountCents: 0.5 },
      "period-bad": { ...ITEM, activeFrom: "1999-12", activeTo: "2101-01" },
      "position-fraction": { ...ITEM, position: 0.5 },
      "position-negative": { ...ITEM, position: -3 },
    },
  }),
  ...gen("IncomeResponseSchema", INCOME, {
    allNull: { ...INCOME, validTo: null },
    extra: { "amount-zero": { ...INCOME, amountCents: 0 }, "amount-negative": { ...INCOME, amountCents: -1 }, "period-bad": { ...INCOME, validFrom: "x", validTo: "y" } },
  }),
  ...gen("CreateFixedCostItemRequestSchema", CREATE_ITEM, {
    mode: "full",
    minimal: { label: "Miete", amountCents: 1, activeFrom: "2026-01" },
    lens: { label: [79, 80, 81] },
    extra: {
      "label-padded": { ...CREATE_ITEM, label: "  Miete  " },
      "label-blank": { ...CREATE_ITEM, label: "   " },
      "amount-zero": { ...CREATE_ITEM, amountCents: 0 },
      "amount-negative": { ...CREATE_ITEM, amountCents: -1 },
      "amount-fraction": { ...CREATE_ITEM, amountCents: 1.5 },
      "amount-string": { ...CREATE_ITEM, amountCents: "100" },
      "active-to-null": { ...CREATE_ITEM, activeTo: null },
      "active-to-undefined": { ...CREATE_ITEM, activeTo: undefined },
      "active-to-before-from": { ...CREATE_ITEM, activeFrom: "2026-12", activeTo: "2026-01" },
      "active-from-bounds-low": { ...CREATE_ITEM, activeFrom: "1999-12" },
      "active-from-bounds-high": { ...CREATE_ITEM, activeFrom: "2101-01" },
      "active-to-bounds-low": { ...CREATE_ITEM, activeTo: "1999-12" },
      "position-null": { ...CREATE_ITEM, position: null },
      "position-fraction": { ...CREATE_ITEM, position: 0.5 },
      "all-bad": { label: "", amountCents: 0, activeFrom: "x", activeTo: "y", position: "z" },
    },
  }),
  ...gen("UpdateFixedCostItemRequestSchema", CREATE_ITEM, {
    mode: "full",
    lens: { label: [80, 81] },
    extra: {
      empty: {},
      "unknown-only": { foo: 1 },
      "label-padded": { label: "  Miete  " },
      "label-empty": { label: "" },
      "amount-zero": { amountCents: 0 },
      "amount-negative": { amountCents: -1 },
      "active-to-null": { activeTo: null },
      "active-to-undefined": { activeTo: undefined },
      "all-undefined": { label: undefined, amountCents: undefined, activeFrom: undefined, activeTo: undefined, position: undefined },
      "all-bad": { label: "", amountCents: 0, activeFrom: "x", activeTo: "y", position: "z" },
    },
  }),
  ...singleKeys("UpdateFixedCostItemRequestSchema", CREATE_ITEM),
  ...gen("CreateIncomeRequestSchema", CREATE_INCOME, {
    mode: "full",
    minimal: { personId: ID2, amountCents: 1, validFrom: "2026-01" },
    extra: {
      "amount-zero": { ...CREATE_INCOME, amountCents: 0 },
      "amount-negative": { ...CREATE_INCOME, amountCents: -100 },
      "amount-fraction": { ...CREATE_INCOME, amountCents: 1.5 },
      "valid-to-null": { ...CREATE_INCOME, validTo: null },
      "valid-to-before-from": { ...CREATE_INCOME, validFrom: "2026-12", validTo: "2026-01" },
      "period-bounds": { ...CREATE_INCOME, validFrom: "1999-12", validTo: "2101-01" },
      "person-bad": { ...CREATE_INCOME, personId: "x" },
      "all-bad": { personId: "x", amountCents: 0, validFrom: "x", validTo: "y" },
    },
  }),
  ...gen("UpdateIncomeRequestSchema", CREATE_INCOME, {
    mode: "full",
    extra: {
      empty: {},
      "amount-zero": { amountCents: 0 },
      "valid-to-null": { validTo: null },
      "valid-to-undefined": { validTo: undefined },
      "all-undefined": { personId: undefined, amountCents: undefined, validFrom: undefined, validTo: undefined },
      "all-bad": { personId: "x", amountCents: 0, validFrom: "x", validTo: "y" },
    },
  }),
  ...singleKeys("UpdateIncomeRequestSchema", CREATE_INCOME),
  ...gen("PlanShareResponseSchema", { personId: ID, incomeCents: 300000, shareCents: 60000 }, { mode: "full", extra: { fraction: { personId: ID, incomeCents: 0.5, shareCents: 1 }, negative: { personId: ID, incomeCents: -1, shareCents: -1 } } }),
  ...gen("PlanComputationResponseSchema", COMPUTATION, {
    extra: {
      "quote-fraction": { ...COMPUTATION, quoteNumerator: 0.5 },
      "quote-zero": { ...COMPUTATION, quoteNumerator: 0, quoteDenominator: 0 },
      "shares-empty": { ...COMPUTATION, shares: [] },
      "share-bad": { ...COMPUTATION, shares: [{ personId: "x" }] },
      "period-bounds": { ...COMPUTATION, period: "1999-12" },
    },
  }),
  ...gen("AccrualRunResponseSchema", RUN, {
    allNull: { ...RUN, fromPeriod: null, toPeriod: null, error: null },
    extra: {
      "trigger-interval": { ...RUN, trigger: "interval" },
      "trigger-manual": { ...RUN, trigger: "manual" },
      "trigger-import": { ...RUN, trigger: "import" },
      "trigger-bad": { ...RUN, trigger: "cron" },
      "trigger-upper": { ...RUN, trigger: "BOOT" },
      "error-text": { ...RUN, error: "boom" },
      "booked-negative": { ...RUN, periodsBooked: -1 },
      "skipped-fraction": { ...RUN, periodsSkipped: 0.5 },
      "period-bad": { ...RUN, fromPeriod: "1999-12", toPeriod: "x" },
    },
  }),
  ...gen("AccrualRunListResponseSchema", { items: [RUN], total: 1, limit: 10, offset: 0 }, {
    depth: 0,
    minimal: { items: [], total: 0, limit: 1, offset: 0 },
    extra: { "limit-zero": { items: [], total: 0, limit: 0, offset: 0 }, "total-negative": { items: [], total: -1, limit: 1, offset: 0 } },
  }),
  ...gen("PlanResponseSchema", { plan: { enabled: true, payerId: ID, startPeriod: "2026-01", lastBookedPeriod: "2026-09" }, items: [ITEM], incomes: [INCOME], current: COMPUTATION, lastRun: RUN, pendingPeriods: ["2026-10"] }, {
    depth: 1,
    minimal: { plan: { enabled: false, payerId: ID, startPeriod: "2026-01", lastBookedPeriod: null }, items: [], incomes: [], current: null, lastRun: null, pendingPeriods: [] },
    extra: {
      "plan-bad": { plan: { enabled: 1 }, items: [], incomes: [], current: null, lastRun: null, pendingPeriods: [] },
      "pending-bad": { plan: { enabled: true, payerId: ID, startPeriod: "2026-01", lastBookedPeriod: null }, items: [], incomes: [], current: null, lastRun: null, pendingPeriods: ["x"] },
      "pending-bounds": { plan: { enabled: true, payerId: ID, startPeriod: "2026-01", lastBookedPeriod: null }, items: [], incomes: [], current: null, lastRun: null, pendingPeriods: ["2101-01", "1999-12"] },
      "item-bad": { plan: { enabled: true, payerId: ID, startPeriod: "2026-01", lastBookedPeriod: null }, items: [{ id: "x" }], incomes: [], current: null, lastRun: null, pendingPeriods: [] },
    },
  }),
  ...gen("RunPlanRequestSchema", { through: "2026-10" }, {
    mode: "full",
    minimal: {},
    extra: { "through-low": { through: "1999-12" }, "through-high": { through: "2101-01" }, "through-bad": { through: "x" }, "through-undefined": { through: undefined }, "through-null": { through: null } },
  }),
  ...gen("RunPlanResponseSchema", { bookedPeriods: ["2026-10"], skippedPeriods: ["2026-09"], bookedCents: 100000, run: RUN }, {
    depth: 0,
    minimal: { bookedPeriods: [], skippedPeriods: [], bookedCents: 0, run: RUN },
    extra: { "period-bad": { bookedPeriods: ["x"], skippedPeriods: ["y"], bookedCents: 0, run: RUN }, "run-bad": { bookedPeriods: [], skippedPeriods: [], bookedCents: 0, run: { id: "x" } } },
  }),
  ...gen("RecalculatePlanRequestSchema", { dryRun: true }, {
    mode: "full",
    extra: { false: { dryRun: false }, string: { dryRun: "true" }, one: { dryRun: 1 }, "absent-with-key": { other: true } },
  }),
  ...gen("RecalculationLineSchema", RECALC_LINE, {
    mode: "full",
    extra: { "period-bad": { ...RECALC_LINE, period: "1999-12" }, fraction: { ...RECALC_LINE, deltaCents: 0.5 }, negative: { ...RECALC_LINE, deltaCents: -200 } },
  }),
  ...gen("RecalculatePlanResponseSchema", { items: [RECALC_LINE], totalDeltaCents: 200, applied: true, adjustments: [TX] }, {
    depth: 0,
    minimal: { items: [], totalDeltaCents: 0, applied: false, adjustments: [] },
    extra: { "adjustment-bad": { items: [], totalDeltaCents: 0, applied: false, adjustments: [{ id: "x" }] }, "item-bad": { items: [{ period: "x" }], totalDeltaCents: 0, applied: false, adjustments: [] } },
  }),
]);
