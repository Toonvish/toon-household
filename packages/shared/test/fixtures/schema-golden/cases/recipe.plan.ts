import { gen, leaf, singleKeys, uniqueIds, type Case, nonFinite } from "./_lib.ts";
import { ID, ID2, ID3, TS, rep } from "./_fixtures.ts";

const PLAN_RECIPE = { id: ID, title: "Linsensuppe", thumbnailUrl: "/uploads/t.webp", totalMinutes: 40, servingsAmount: 4, servingsUnit: "Portionen" };
const PLAN_RECIPE_MIN = { id: ID, title: "T" };
const ENTRY = { id: ID, householdId: ID2, recipeId: ID3, plannedOn: "2026-10-16", position: 0, servings: 4, note: "Wochenende", cookedAt: TS, createdBy: ID, createdAt: TS, updatedAt: TS, recipe: PLAN_RECIPE };
const ENTRY_MIN = { id: ID, householdId: ID2, recipeId: ID3, plannedOn: "2026-10-16", position: 0, createdBy: ID, createdAt: TS, updatedAt: TS, recipe: PLAN_RECIPE_MIN };
const ENTRY_NULL = { ...ENTRY, servings: null, note: null, cookedAt: null, recipe: { ...PLAN_RECIPE, thumbnailUrl: null, totalMinutes: null, servingsAmount: null, servingsUnit: null } };

const DATES = [
  "2026-10-16",
  "2024-02-29",
  "2000-02-29",
  "2025-02-29",
  "1900-02-29",
  "2100-02-29",
  "2026-02-30",
  "2026-04-31",
  "2026-13-01",
  "2026-00-10",
  "2026-10-00",
  "2026-10-32",
  "2026-1-5",
  "26-10-16",
  "0000-01-01",
  "0001-01-01",
  "9999-12-31",
  "2026-10-16T00:00:00Z",
  " 2026-10-16",
  "2026-10-16 ",
  "2026-10-16\n",
  "2026/10/16",
  "2026.10.16",
  "20261016",
  "２０２６-10-16",
  "heute",
  "2026-10-16\u0000",
];

const RANGES: ReadonlyArray<readonly [string, string, string]> = [
  ["equal", "2026-10-01", "2026-10-01"],
  ["week", "2026-10-05", "2026-10-11"],
  ["60-days", "2026-10-01", "2026-11-30"],
  ["61-days", "2026-10-01", "2026-12-01"],
  ["62-days", "2026-10-01", "2026-12-02"],
  ["63-days", "2026-10-01", "2026-12-03"],
  ["year", "2026-01-01", "2026-12-31"],
  ["reversed", "2026-10-02", "2026-10-01"],
  ["reversed-long", "2026-12-31", "2026-01-01"],
  ["from-bad", "2026-02-30", "2026-03-01"],
  ["to-bad", "2026-03-01", "2026-02-30"],
  ["both-bad", "x", "y"],
  ["both-bad-reversed", "2026-13-40", "2026-00-00"],
  ["from-empty", "", "2026-03-01"],
  ["leap-span", "2024-02-01", "2024-03-31"],
  ["dst-span", "2026-03-01", "2026-04-30"],
];

export const cases: Case[] = uniqueIds([
  ...leaf("PlanDateSchema", DATES),
  ...gen("PlanRecipeSchema", PLAN_RECIPE, {
    minimal: PLAN_RECIPE_MIN,
    allNull: { ...PLAN_RECIPE, thumbnailUrl: null, totalMinutes: null, servingsAmount: null, servingsUnit: null },
    extra: {
      "minutes-negative": { ...PLAN_RECIPE, totalMinutes: -1 },
      "minutes-fraction": { ...PLAN_RECIPE, totalMinutes: 0.5 },
      "servings-zero": { ...PLAN_RECIPE, servingsAmount: 0 },
      "servings-negative": { ...PLAN_RECIPE, servingsAmount: -1 },
    },
  }),
  ...gen("MealPlanEntrySchema", ENTRY, {
    depth: 1,
    minimal: ENTRY_MIN,
    allNull: ENTRY_NULL,
    extra: {
      "planned-on-bad": { ...ENTRY, plannedOn: "2026-02-30" },
      "planned-on-iso": { ...ENTRY, plannedOn: TS },
      "position-negative": { ...ENTRY, position: -1 },
      "position-fraction": { ...ENTRY, position: 0.5 },
      "servings-zero": { ...ENTRY, servings: 0 },
      "servings-negative": { ...ENTRY, servings: -1 },
      "recipe-bad": { ...ENTRY, recipe: { id: "x" } },
      "recipe-null": { ...ENTRY, recipe: null },
    },
  }),
  ...gen("MealPlanRangeQuerySchema", { from: "2026-10-01", to: "2026-10-31" }, {
    mode: "full",
    extra: Object.fromEntries(
      RANGES.flatMap(([label, from, to]) => [
        [`range-${label}`, { from, to }],
      ]),
    ),
  }),
  ...gen("CreateMealPlanEntryRequestSchema", { recipeId: ID, plannedOn: "2026-10-16", servings: 4, note: "Notiz" }, {
    mode: "full",
    minimal: { recipeId: ID, plannedOn: "2026-10-16" },
    allNull: { recipeId: ID, plannedOn: "2026-10-16", servings: null, note: null },
    lens: { note: [299, 300, 301] },
    extra: {
      "servings-1000": { recipeId: ID, plannedOn: "2026-10-16", servings: 1000 },
      "servings-1001": { recipeId: ID, plannedOn: "2026-10-16", servings: 1001 },
      "servings-fraction": { recipeId: ID, plannedOn: "2026-10-16", servings: 0.5 },
      "servings-tiny": { recipeId: ID, plannedOn: "2026-10-16", servings: 1e-9 },
      "servings-zero": { recipeId: ID, plannedOn: "2026-10-16", servings: 0 },
      "servings-negative": { recipeId: ID, plannedOn: "2026-10-16", servings: -1 },
      "note-padded": { recipeId: ID, plannedOn: "2026-10-16", note: "  n  " },
      "note-blank": { recipeId: ID, plannedOn: "2026-10-16", note: "   " },
      "planned-on-bad-date": { recipeId: ID, plannedOn: "2025-02-29" },
      "all-bad": { recipeId: "x", plannedOn: "y", servings: 0, note: rep("n", 301) },
    },
  }),
  ...gen("UpdateMealPlanEntryRequestSchema", { plannedOn: "2026-10-16", position: 2, servings: 4, note: "Notiz" }, {
    mode: "full",
    lens: { note: [300, 301] },
    extra: {
      empty: {},
      "unknown-only": { foo: 1 },
      "position-0": { position: 0 },
      "position-1000": { position: 1000 },
      "position-1001": { position: 1001 },
      "position-negative": { position: -1 },
      "position-fraction": { position: 0.5 },
      "servings-null": { servings: null },
      "servings-1001": { servings: 1001 },
      "servings-zero": { servings: 0 },
      "note-null": { note: null },
      "note-padded": { note: "  n  " },
      "planned-on-bad": { plannedOn: "x" },
      "all-undefined": { plannedOn: undefined, position: undefined, servings: undefined, note: undefined },
      "all-bad": { plannedOn: "x", position: -1, servings: 0, note: rep("n", 301) },
      "bad-and-unknown": { position: -1, foo: 1 },
    },
  }),
  ...singleKeys("UpdateMealPlanEntryRequestSchema", { plannedOn: "2026-10-16", position: 2, servings: 4, note: "Notiz" }),
  ...gen("LastPlannedQuerySchema", { before: "2026-10-16" }, { mode: "full", extra: { "before-bad": { before: "2025-02-29" }, "before-iso": { before: TS } } }),
  ...gen("MarkCookedRequestSchema", { plannedOn: "2026-10-16", mealPlanEntryId: ID }, {
    mode: "full",
    minimal: {},
    extra: { "planned-on-bad": { plannedOn: "2026-02-30" }, "entry-bad": { mealPlanEntryId: "x" }, "entry-null": { mealPlanEntryId: null }, "planned-on-null": { plannedOn: null }, "all-bad": { plannedOn: "x", mealPlanEntryId: "y" } },
  }),
  ...gen("MealPlanRangeResponseSchema", { from: "2026-10-01", to: "2026-10-31", items: [ENTRY_MIN] }, {
    depth: 0,
    minimal: { from: "2026-10-01", to: "2026-10-31", items: [] },
    extra: { full: { from: "2026-10-01", to: "2026-10-31", items: [ENTRY] }, "from-bad": { from: "x", to: "2026-10-31", items: [] }, "item-bad": { from: "2026-10-01", to: "2026-10-31", items: [{ id: "x" }] }, "reversed-allowed": { from: "2026-10-31", to: "2026-10-01", items: [] } },
  }),
  ...gen("LastPlannedResponseSchema", { before: "2026-10-16", items: [{ recipeId: ID, plannedOn: "2026-10-01" }] }, {
    minimal: { before: "2026-10-16", items: [] },
    extra: { "before-bad": { before: "x", items: [] }, "item-bad": { before: "2026-10-16", items: [{ recipeId: "x", plannedOn: "y" }] }, "item-date-bad": { before: "2026-10-16", items: [{ recipeId: ID, plannedOn: "2026-02-30" }] } },
  }),
  ...gen("MealPlanEntryResponseSchema", { entry: ENTRY_MIN }, { depth: 0, extra: { full: { entry: ENTRY }, "all-null": { entry: ENTRY_NULL }, "entry-bad": { entry: { id: "x" } } } }),
  ...gen("RecipeCookedResponseSchema", { recipeId: ID, cookedAt: TS, lastCookedAt: TS, mealPlanEntry: ENTRY_MIN }, {
    depth: 0,
    allNull: { recipeId: ID, cookedAt: TS, lastCookedAt: TS, mealPlanEntry: null },
    extra: { full: { recipeId: ID, cookedAt: TS, lastCookedAt: TS, mealPlanEntry: ENTRY }, "entry-undefined": { recipeId: ID, cookedAt: TS, lastCookedAt: TS, mealPlanEntry: undefined }, "entry-bad": { recipeId: ID, cookedAt: TS, lastCookedAt: TS, mealPlanEntry: { id: "x" } } },
  }),
  ...nonFinite("MealPlanEntryResponseSchema", { entry: ENTRY }),
  ...nonFinite("MealPlanRangeResponseSchema", { from: "2026-10-01", to: "2026-10-31", items: [ENTRY] }),
  ...nonFinite("RecipeCookedResponseSchema", { recipeId: ID, cookedAt: TS, lastCookedAt: TS, mealPlanEntry: ENTRY }),
]);
