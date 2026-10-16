/**
 * Meal planner ("Wochenplan") — wire contract.
 *
 * `plannedOn` is a CALENDAR DATE (`YYYY-MM-DD`), not a timestamp: see
 * packages/shared/src/calendar.ts and the `meal_plan_entries` comment in
 * apps/api/src/db/schema.ts. The client computes it from the DEVICE's local calendar;
 * the server never derives a date from `Date.now()`. Every other timestamp here is
 * the usual ISO string.
 *
 * `RecipeCookedResponseSchema` and `MarkCookedRequestSchema` live here rather than in
 * schemas/recipe.ts because they straddle recipes and the planner (a "Cooked" tap can
 * stamp a plan entry) and this is the file that already imports `PlanDateSchema` — see
 * A02 §3.4. `index.ts` flattens the re-export, so nothing else needs to know that.
 */
import { Schema, type Types } from "effect";
import { isPlanDate, planDaysBetween } from "../../../core/calendar.ts";
import {
  Int,
  Num,
  Str,
  keyed,
  max,
  maxLength,
  min,
  nonnegative,
  positive,
  trim,
} from "../../../core/schemas/checks.ts";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";

export const PLAN_LIMITS = {
  /** Recipes on ONE day. A cap because rows are unbounded otherwise. */
  entriesPerDay: 12,
  /** Longest range a single GET may ask for (two months + a fortnight). */
  rangeDays: 62,
  /** The cap T4.3's `from-plan` shopping diff honours (earliest-first). */
  fromPlanEntries: 60,
} as const;

/** `YYYY-MM-DD`, and a date that really exists ("2026-02-31" does not). */
export const PlanDateSchema = Str.check(keyed(isPlanDate, "server.plan.invalidDate"));

/** The slim recipe a planner card renders: thumb, serif title, `meta`. */
export const PlanRecipeSchema = Schema.Struct({
  id: IdSchema,
  title: Str,
  /** List image — `thumbnailUrl()`, never `imageUrl` (CLAUDE.md thumbnail gotcha). */
  thumbnailUrl: Schema.optional(Schema.NullOr(Str)),
  totalMinutes: Schema.optional(Schema.NullOr(Int.check(nonnegative()))),
  servingsAmount: Schema.optional(Schema.NullOr(Num.check(positive()))),
  servingsUnit: Schema.optional(Schema.NullOr(Str)),
});
export type PlanRecipe = Types.DeepMutable<typeof PlanRecipeSchema.Type>;

export const MealPlanEntrySchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  recipeId: IdSchema,
  plannedOn: PlanDateSchema,
  position: Int.check(nonnegative()),
  /** null = the recipe's own servings. */
  servings: Schema.optional(Schema.NullOr(Num.check(positive()))),
  note: Schema.optional(Schema.NullOr(Str)),
  /** Non-null draws `cooked ✓` on the day card. */
  cookedAt: Schema.optional(Schema.NullOr(IsoDateSchema)),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  recipe: PlanRecipeSchema,
});
export type MealPlanEntry = Types.DeepMutable<typeof MealPlanEntrySchema.Type>;

/* ------------------------------- requests -------------------------------- */

export const MealPlanRangeQuerySchema = Schema.Struct({ from: PlanDateSchema, to: PlanDateSchema }).check(
  keyed((v) => v.from <= v.to, "server.plan.rangeInvalid"),
  // String compare is chronological for ISO dates, so the guard needs no parsing.
  keyed((v) => planDaysBetween(v.from, v.to) < PLAN_LIMITS.rangeDays, "server.plan.rangeTooLong"),
);
export type MealPlanRangeQuery = Types.DeepMutable<typeof MealPlanRangeQuerySchema.Type>;

export const CreateMealPlanEntryRequestSchema = Schema.Struct({
  recipeId: IdSchema,
  plannedOn: PlanDateSchema,
  servings: Schema.optional(Schema.NullOr(Num.check(positive(), max(1000)))),
  note: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(300)))),
});
export type CreateMealPlanEntryRequest = Types.DeepMutable<typeof CreateMealPlanEntryRequestSchema.Type>;

/** Moving an entry to another day is a PATCH of `plannedOn` — that is the drag-and-drop. */
export const UpdateMealPlanEntryRequestSchema = Schema.Struct({
  plannedOn: Schema.optional(PlanDateSchema),
  position: Schema.optional(Int.check(min(0), max(1000))),
  servings: Schema.optional(Schema.NullOr(Num.check(positive(), max(1000)))),
  note: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(300)))),
}).check(keyed((v) => Object.keys(v).length > 0, "server.validation.noChanges"));
export type UpdateMealPlanEntryRequest = Types.DeepMutable<typeof UpdateMealPlanEntryRequestSchema.Type>;

/**
 * "Zuletzt geplant" for the recipe picker: the latest day each recipe was planned
 * STRICTLY BEFORE `before` — the day being planned, which the CLIENT computed (the
 * server never derives a date). Strictly before, so the day itself never answers
 * "last planned: today".
 */
export const LastPlannedQuerySchema = Schema.Struct({ before: PlanDateSchema });
export type LastPlannedQuery = Types.DeepMutable<typeof LastPlannedQuerySchema.Type>;

/**
 * "Gekocht": optional-everything, so a bare `POST {}` works (the phone's 52 px check
 * button). `mealPlanEntryId` is what the entry knows already; `plannedOn` lets a
 * caller off the planner (e.g. the recipe detail page) still stamp the right day.
 * There is deliberately no client-supplied `cookedAt` — the server's clock is the one
 * authority for "when"; see A02 §3.4.
 */
export const MarkCookedRequestSchema = Schema.Struct({
  /** The calendar date the cook happened, in the USER's calendar. Optional. */
  plannedOn: Schema.optional(PlanDateSchema),
  /** The plan entry to stamp, when the client knows it (the /plan screen does). */
  mealPlanEntryId: Schema.optional(IdSchema),
});
export type MarkCookedRequest = Types.DeepMutable<typeof MarkCookedRequestSchema.Type>;

/* ------------------------------- responses ------------------------------- */

/**
 * FLAT and sorted by `(plannedOn, position)`, deliberately not grouped by day: a day
 * with nothing planned has no entry, and the seven-slot week (including the `+ Plan`
 * empty cards) is built client-side by `planWeek()`. That is what keeps the server
 * from having to know what a week is, or whose week it is.
 *
 * NOT the `{ items, total, limit, offset }` envelope (R5): that envelope is for
 * paginated lists, and a week is bounded by its own `from`/`to`, not a page —
 * `PLAN_LIMITS.rangeDays` is the bound.
 */
export const MealPlanRangeResponseSchema = Schema.Struct({
  from: PlanDateSchema,
  to: PlanDateSchema,
  items: Schema.Array(MealPlanEntrySchema),
});
export type MealPlanRangeResponse = Types.DeepMutable<typeof MealPlanRangeResponseSchema.Type>;

/**
 * One row per recipe that has EVER been planned before `before`; a recipe absent
 * from `items` has never been planned. Unpaginated, because it is bounded by the
 * household's recipe count, not by its plan history.
 */
export const LastPlannedResponseSchema = Schema.Struct({
  before: PlanDateSchema,
  items: Schema.Array(Schema.Struct({ recipeId: IdSchema, plannedOn: PlanDateSchema })),
});
export type LastPlannedResponse = Types.DeepMutable<typeof LastPlannedResponseSchema.Type>;

export const MealPlanEntryResponseSchema = Schema.Struct({ entry: MealPlanEntrySchema });
export type MealPlanEntryResponse = Types.DeepMutable<typeof MealPlanEntryResponseSchema.Type>;

export const RecipeCookedResponseSchema = Schema.Struct({
  recipeId: IdSchema,
  cookedAt: IsoDateSchema,
  lastCookedAt: IsoDateSchema,
  /** The stamped plan entry, or null when the recipe was not on the plan that day. */
  mealPlanEntry: Schema.NullOr(MealPlanEntrySchema),
});
export type RecipeCookedResponse = Types.DeepMutable<typeof RecipeCookedResponseSchema.Type>;
