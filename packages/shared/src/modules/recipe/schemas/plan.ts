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
import { z } from "zod";
import { refineKey } from "../../../core/i18n/zod.ts";
import { isPlanDate, planDaysBetween } from "../../../core/calendar.ts";
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
export const PlanDateSchema = z
  .string()
  .refine(isPlanDate, refineKey("server.plan.invalidDate"));

/** The slim recipe a planner card renders: thumb, serif title, `meta`. */
export const PlanRecipeSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** List image — `thumbnailUrl()`, never `imageUrl` (CLAUDE.md thumbnail gotcha). */
  thumbnailUrl: z.string().nullish(),
  totalMinutes: z.number().int().nonnegative().nullish(),
  servingsAmount: z.number().positive().nullish(),
  servingsUnit: z.string().nullish(),
});
export type PlanRecipe = z.infer<typeof PlanRecipeSchema>;

export const MealPlanEntrySchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  recipeId: IdSchema,
  plannedOn: PlanDateSchema,
  position: z.number().int().nonnegative(),
  /** null = the recipe's own servings. */
  servings: z.number().positive().nullish(),
  note: z.string().nullish(),
  /** Non-null draws `cooked ✓` on the day card. */
  cookedAt: IsoDateSchema.nullish(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  recipe: PlanRecipeSchema,
});
export type MealPlanEntry = z.infer<typeof MealPlanEntrySchema>;

/* ------------------------------- requests -------------------------------- */

export const MealPlanRangeQuerySchema = z
  .object({ from: PlanDateSchema, to: PlanDateSchema })
  .refine((v) => v.from <= v.to, refineKey("server.plan.rangeInvalid"))
  // String compare is chronological for ISO dates, so the guard needs no parsing.
  .refine(
    (v) => planDaysBetween(v.from, v.to) < PLAN_LIMITS.rangeDays,
    refineKey("server.plan.rangeTooLong"),
  );
export type MealPlanRangeQuery = z.infer<typeof MealPlanRangeQuerySchema>;

export const CreateMealPlanEntryRequestSchema = z.object({
  recipeId: IdSchema,
  plannedOn: PlanDateSchema,
  servings: z.number().positive().max(1000).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export type CreateMealPlanEntryRequest = z.infer<typeof CreateMealPlanEntryRequestSchema>;

/** Moving an entry to another day is a PATCH of `plannedOn` — that is the drag-and-drop. */
export const UpdateMealPlanEntryRequestSchema = z
  .object({
    plannedOn: PlanDateSchema.optional(),
    position: z.number().int().min(0).max(1000).optional(),
    servings: z.number().positive().max(1000).nullish(),
    note: z.string().trim().max(300).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, refineKey("server.validation.noChanges"));
export type UpdateMealPlanEntryRequest = z.infer<typeof UpdateMealPlanEntryRequestSchema>;

/**
 * "Zuletzt geplant" for the recipe picker: the latest day each recipe was planned
 * STRICTLY BEFORE `before` — the day being planned, which the CLIENT computed (the
 * server never derives a date). Strictly before, so the day itself never answers
 * "last planned: today".
 */
export const LastPlannedQuerySchema = z.object({ before: PlanDateSchema });
export type LastPlannedQuery = z.infer<typeof LastPlannedQuerySchema>;

/**
 * "Gekocht": optional-everything, so a bare `POST {}` works (the phone's 52 px check
 * button). `mealPlanEntryId` is what the entry knows already; `plannedOn` lets a
 * caller off the planner (e.g. the recipe detail page) still stamp the right day.
 * There is deliberately no client-supplied `cookedAt` — the server's clock is the one
 * authority for "when"; see A02 §3.4.
 */
export const MarkCookedRequestSchema = z.object({
  /** The calendar date the cook happened, in the USER's calendar. Optional. */
  plannedOn: PlanDateSchema.optional(),
  /** The plan entry to stamp, when the client knows it (the /plan screen does). */
  mealPlanEntryId: IdSchema.optional(),
});
export type MarkCookedRequest = z.infer<typeof MarkCookedRequestSchema>;

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
export const MealPlanRangeResponseSchema = z.object({
  from: PlanDateSchema,
  to: PlanDateSchema,
  items: z.array(MealPlanEntrySchema),
});
export type MealPlanRangeResponse = z.infer<typeof MealPlanRangeResponseSchema>;

/**
 * One row per recipe that has EVER been planned before `before`; a recipe absent
 * from `items` has never been planned. Unpaginated, because it is bounded by the
 * household's recipe count, not by its plan history.
 */
export const LastPlannedResponseSchema = z.object({
  before: PlanDateSchema,
  items: z.array(z.object({ recipeId: IdSchema, plannedOn: PlanDateSchema })),
});
export type LastPlannedResponse = z.infer<typeof LastPlannedResponseSchema>;

export const MealPlanEntryResponseSchema = z.object({ entry: MealPlanEntrySchema });
export type MealPlanEntryResponse = z.infer<typeof MealPlanEntryResponseSchema>;

export const RecipeCookedResponseSchema = z.object({
  recipeId: IdSchema,
  cookedAt: IsoDateSchema,
  lastCookedAt: IsoDateSchema,
  /** The stamped plan entry, or null when the recipe was not on the plan that day. */
  mealPlanEntry: MealPlanEntrySchema.nullable(),
});
export type RecipeCookedResponse = z.infer<typeof RecipeCookedResponseSchema>;
