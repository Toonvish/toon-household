/**
 * The meal planner ("Wochenplan") — SPEC.md §4.1 / D7.
 *
 * `plannedOn` is a CALENDAR DATE the CLIENT computed (`toPlanDate()` in
 * `@toon/shared`'s `calendar.ts`); nothing in this file ever calls `new Date()` to
 * decide what day it is — see the `meal_plan_entries` table comment in
 * `db/schema.ts` for the full reasoning (server UTC vs. Europe/Berlin users).
 *
 * ANY MEMBER may plan or unplan ANY entry — a shared week is shared property, the
 * same rule `updateShoppingList` already applies to renaming a shopping list. There
 * is no `assertCanModifyOwned` anywhere here.
 *
 * Planner writes are ONLINE-ONLY (SPEC.md §5): there is no `mutationId` ledger like
 * the shopping list's. The `recipe_meal_plan_entries_household_date_recipe_unique` index is
 * the whole idempotency story for POST — see `createPlanEntry`.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9). `MealPlan` reads the current
 * executor of `Database` on every call (inside `Database.transaction` that is the open transaction), takes its
 * timestamps from the `Clock`, looks a recipe up through `Recipes` and refuses with the tagged family.
 */
import {
  PLAN_LIMITS,
  type CreateMealPlanEntryRequest,
  type MealPlanEntry,
  type PlanDate,
  type UpdateMealPlanEntryRequest,
} from "@toon/shared";
import { and, asc, count, eq, gte, lt, lte, max, ne } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { mealPlanEntries, recipes } from "../../../../db/schema.ts";
import type { MealPlanEntryRow, NewMealPlanEntryRow } from "../../../../db/schema.ts";
import { Conflict, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { isUniqueViolation } from "../../../../core/services/auth/users.ts";
import { Recipes } from "../recipes/recipes.service.ts";
import { toMealPlanEntry } from "./mappers.ts";

/** What a create wrote: the row and whether it is new (`false`: the existing row was restamped). */
interface PlanWrite {
  readonly row: MealPlanEntryRow;
  readonly created: boolean;
}

/** The meal planner of a household. */
export class MealPlan extends Context.Service<
  MealPlan,
  {
    /**
     * Entries in `[from, to]`, flat, `(plannedOn, position)` order — ONE query with an
     * `innerJoin` on `recipes`. A week is at most `7 × PLAN_LIMITS.entriesPerDay` rows
     * and a local libSQL file is one serialised lane (CLAUDE.md), so one round trip
     * beats a second `inArray` query for the recipes.
     *
     * `recipe_meal_plan_entries_household_date_idx` (`household_id, planned_on, position`) supplies
     * both the range scan and the `ORDER BY` — see `test/plan.test.ts`'s
     * `explain query plan` assertion.
     */
    readonly listPlanEntries: (
      householdId: string,
      from: PlanDate,
      to: PlanDate,
    ) => Effect.Effect<MealPlanEntry[], DatabaseError>;
    /**
     * The latest `plannedOn` per recipe strictly before `before` — the picker's
     * "Zuletzt geplant". One grouped `max()` over the household's history; `plannedOn` is
     * `YYYY-MM-DD`, so the lexicographic max IS the latest date.
     */
    readonly listLastPlanned: (
      householdId: string,
      before: PlanDate,
    ) => Effect.Effect<Array<{ recipeId: string; plannedOn: PlanDate }>, DatabaseError>;
    /**
     * The raw entry inside `householdId`, or `undefined` for a cross-household id — scoped by
     * `and(eq(id), eq(householdId))` so a cross-household id answers 404 rather than leaking
     * (consumed by `CookLog.recordCooked` to verify a client-supplied `mealPlanEntryId`).
     */
    readonly loadPlanEntryRow: (
      householdId: string,
      entryId: string,
    ) => Effect.Effect<MealPlanEntryRow | undefined, DatabaseError>;
    /**
     * The entry (if any) that already puts `recipeId` on `plannedOn` — the ONLY place
     * a date-to-entry resolution happens. Takes the date as a parameter precisely
     * because the caller (`CookLog.recordCooked`) never derives one itself.
     */
    readonly findPlanEntryForRecipeOnDay: (
      householdId: string,
      recipeId: string,
      plannedOn: PlanDate,
    ) => Effect.Effect<MealPlanEntryRow | undefined, DatabaseError>;
    /**
     * Plans `input.recipeId` on `input.plannedOn`. POST is idempotent: planning the
     * same recipe on the same day twice returns the EXISTING row with
     * `created: false` and applies the second call's `servings`, rather than raising
     * a duplicate. Written as a pre-check inside the transaction plus a recovered
     * UNIQUE-constraint error, in that order — the pre-check keeps the normal path
     * readable, the recovery is what makes a race between two members correct.
     */
    readonly createPlanEntry: (
      householdId: string,
      userId: string,
      input: CreateMealPlanEntryRequest,
    ) => Effect.Effect<{ entry: MealPlanEntry; created: boolean }, NotFound | Conflict | DatabaseError>;
    /**
     * Moving `plannedOn` is the drag-and-drop: it re-tails `position` on the TARGET
     * day unless `position` was sent explicitly (otherwise a moved entry would inherit
     * a position from the day it left and land mid-column on the new one). Moving
     * onto a day that already holds the same recipe never silently merges the two
     * entries — it is a 409, same as the create path's idempotent POST is not.
     */
    readonly updatePlanEntry: (
      householdId: string,
      entryId: string,
      input: UpdateMealPlanEntryRequest,
    ) => Effect.Effect<MealPlanEntry, NotFound | Conflict | DatabaseError>;
    /** Unplans an entry. Any member may remove any entry — see the file header. */
    readonly deletePlanEntry: (householdId: string, entryId: string) => Effect.Effect<void, NotFound | DatabaseError>;
  }
>()("toon/api/modules/recipe/services/plan/plan.service/MealPlan") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const recipeService = yield* Recipes;

      const listPlanEntries = Effect.fn("MealPlan.listPlanEntries")(function* (
        householdId: string,
        from: PlanDate,
        to: PlanDate,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ entry: mealPlanEntries, recipe: recipes })
            .from(mealPlanEntries)
            .innerJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
            .where(
              and(
                eq(mealPlanEntries.householdId, householdId),
                gte(mealPlanEntries.plannedOn, from),
                lte(mealPlanEntries.plannedOn, to),
              ),
            )
            .orderBy(asc(mealPlanEntries.plannedOn), asc(mealPlanEntries.position)),
        );
        return rows.map((row) => toMealPlanEntry(row.entry, row.recipe));
      });

      const listLastPlanned = Effect.fn("MealPlan.listLastPlanned")(function* (householdId: string, before: PlanDate) {
        const rows = yield* database.use((db) =>
          db
            .select({ recipeId: mealPlanEntries.recipeId, plannedOn: max(mealPlanEntries.plannedOn) })
            .from(mealPlanEntries)
            .where(and(eq(mealPlanEntries.householdId, householdId), lt(mealPlanEntries.plannedOn, before)))
            .groupBy(mealPlanEntries.recipeId),
        );
        return rows.flatMap((row) => (row.plannedOn ? [{ recipeId: row.recipeId, plannedOn: row.plannedOn }] : []));
      });

      const loadPlanEntryRow = Effect.fn("MealPlan.loadPlanEntryRow")(function* (householdId: string, entryId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(mealPlanEntries)
            .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlanEntries.householdId, householdId)))
            .limit(1),
        );
        return row;
      });

      /** `loadPlanEntryRow`, but 404s instead of returning `undefined` — the route shape. */
      const requirePlanEntryRow = Effect.fn("MealPlan.requirePlanEntryRow")(function* (
        householdId: string,
        entryId: string,
      ) {
        const row = yield* loadPlanEntryRow(householdId, entryId);
        if (!row) return yield* new NotFound({ text: "server.plan.entryNotFound" });
        return row;
      });

      const findPlanEntryForRecipeOnDay = Effect.fn("MealPlan.findPlanEntryForRecipeOnDay")(function* (
        householdId: string,
        recipeId: string,
        plannedOn: PlanDate,
      ) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(mealPlanEntries)
            .where(
              and(
                eq(mealPlanEntries.householdId, householdId),
                eq(mealPlanEntries.recipeId, recipeId),
                eq(mealPlanEntries.plannedOn, plannedOn),
              ),
            )
            .limit(1),
        );
        return row;
      });

      /** One past the highest `position` already on `plannedOn`, i.e. the tail slot. */
      const nextPositionOnDay = Effect.fn("MealPlan.nextPositionOnDay")(function* (
        householdId: string,
        plannedOn: PlanDate,
      ) {
        const [row] = yield* database.use((db) =>
          db
            .select({ value: max(mealPlanEntries.position) })
            .from(mealPlanEntries)
            .where(and(eq(mealPlanEntries.householdId, householdId), eq(mealPlanEntries.plannedOn, plannedOn))),
        );
        return (row?.value ?? -1) + 1;
      });

      /** How many entries `plannedOn` already holds. */
      const countOnDay = Effect.fn("MealPlan.countOnDay")(function* (householdId: string, plannedOn: PlanDate) {
        const [row] = yield* database.use((db) =>
          db
            .select({ value: count() })
            .from(mealPlanEntries)
            .where(and(eq(mealPlanEntries.householdId, householdId), eq(mealPlanEntries.plannedOn, plannedOn))),
        );
        return Number(row?.value ?? 0);
      });

      /** The idempotent second POST: the existing row takes the new call's `servings`. */
      const restamp = Effect.fn("MealPlan.restamp")(function* (
        existing: MealPlanEntryRow,
        input: CreateMealPlanEntryRequest,
      ) {
        const patch = { servings: input.servings ?? null, updatedAt: yield* Clock.currentTimeMillis };
        yield* database.use((db) => db.update(mealPlanEntries).set(patch).where(eq(mealPlanEntries.id, existing.id)));
        return { row: { ...existing, ...patch }, created: false } satisfies PlanWrite;
      });

      const createPlanEntry = Effect.fn("MealPlan.createPlanEntry")(function* (
        householdId: string,
        userId: string,
        input: CreateMealPlanEntryRequest,
      ) {
        // 404 for a recipe outside the household — reuse the existing lookup, never re-query.
        const recipeRow = yield* recipeService.loadRecipeRow(householdId, input.recipeId);

        const written: PlanWrite = yield* database.transaction(
          Effect.gen(function* () {
            const existing = yield* findPlanEntryForRecipeOnDay(householdId, input.recipeId, input.plannedOn);
            if (existing) return yield* restamp(existing, input);

            if ((yield* countOnDay(householdId, input.plannedOn)) >= PLAN_LIMITS.entriesPerDay) {
              return yield* new Conflict({
                code: "meal_plan_day_full",
                text: { key: "server.plan.dayFull", values: { max: PLAN_LIMITS.entriesPerDay } },
              });
            }

            const now = yield* Clock.currentTimeMillis;
            const newRow: MealPlanEntryRow = {
              id: crypto.randomUUID(),
              householdId,
              recipeId: input.recipeId,
              plannedOn: input.plannedOn,
              position: yield* nextPositionOnDay(householdId, input.plannedOn),
              servings: input.servings ?? null,
              cookedAt: null,
              createdBy: userId,
              createdAt: now,
              updatedAt: now,
            };
            const inserted: PlanWrite = { row: newRow, created: true };
            return yield* database.use((db) => db.insert(mealPlanEntries).values(newRow)).pipe(
              Effect.as(inserted),
              Effect.catchTag("DatabaseError", (error) =>
                Effect.gen(function* () {
                  if (!isUniqueViolation(error.cause)) return yield* error;
                  // Race: another request planned the same (household, day, recipe) between our
                  // pre-check and this insert. The loser applies the same patch the winner
                  // would have got from a second POST, rather than surfacing the race.
                  const race = yield* findPlanEntryForRecipeOnDay(householdId, input.recipeId, input.plannedOn);
                  if (!race) return yield* error;
                  return yield* restamp(race, input);
                }),
              ),
            );
          }),
        );

        return { entry: toMealPlanEntry(written.row, recipeRow), created: written.created };
      });

      const updatePlanEntry = Effect.fn("MealPlan.updatePlanEntry")(function* (
        householdId: string,
        entryId: string,
        input: UpdateMealPlanEntryRequest,
      ) {
        return yield* database.transaction(
          Effect.gen(function* () {
            const row = yield* requirePlanEntryRow(householdId, entryId);
            const movingDay = input.plannedOn !== undefined && input.plannedOn !== row.plannedOn;
            const targetDay = input.plannedOn ?? row.plannedOn;

            if (movingDay) {
              const [clash] = yield* database.use((db) =>
                db
                  .select({ id: mealPlanEntries.id })
                  .from(mealPlanEntries)
                  .where(
                    and(
                      eq(mealPlanEntries.householdId, householdId),
                      eq(mealPlanEntries.plannedOn, targetDay),
                      eq(mealPlanEntries.recipeId, row.recipeId),
                      ne(mealPlanEntries.id, entryId),
                    ),
                  )
                  .limit(1),
              );
              if (clash) return yield* new Conflict({ code: "conflict", text: "server.plan.alreadyPlanned" });

              if ((yield* countOnDay(householdId, targetDay)) >= PLAN_LIMITS.entriesPerDay) {
                return yield* new Conflict({
                  code: "meal_plan_day_full",
                  text: { key: "server.plan.dayFull", values: { max: PLAN_LIMITS.entriesPerDay } },
                });
              }
            }

            const patch: Partial<NewMealPlanEntryRow> = { updatedAt: yield* Clock.currentTimeMillis };
            if (input.plannedOn !== undefined) patch.plannedOn = input.plannedOn;
            patch.position =
              input.position ?? (movingDay ? yield* nextPositionOnDay(householdId, targetDay) : row.position);
            if (input.servings !== undefined) patch.servings = input.servings;
            // note: no column to write to — see mappers.ts.

            yield* database.use((db) => db.update(mealPlanEntries).set(patch).where(eq(mealPlanEntries.id, entryId)));
            const updated = yield* requirePlanEntryRow(householdId, entryId);
            const recipeRow = yield* recipeService.loadRecipeRow(householdId, updated.recipeId);
            return toMealPlanEntry(updated, recipeRow);
          }),
        );
      });

      const deletePlanEntry = Effect.fn("MealPlan.deletePlanEntry")(function* (householdId: string, entryId: string) {
        yield* requirePlanEntryRow(householdId, entryId);
        yield* database.use((db) => db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)));
      });

      return MealPlan.of({
        listPlanEntries,
        listLastPlanned,
        loadPlanEntryRow,
        findPlanEntryForRecipeOnDay,
        createPlanEntry,
        updatePlanEntry,
        deletePlanEntry,
      });
    }),
  );
}
