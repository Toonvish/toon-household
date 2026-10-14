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
 */
import {
  PLAN_LIMITS,
  type CreateMealPlanEntryRequest,
  type MealPlanEntry,
  type PlanDate,
  type UpdateMealPlanEntryRequest,
} from "@toon/shared";
import { and, asc, count, eq, gte, lt, lte, max, ne } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import { mealPlanEntries, recipes } from "../../../../db/schema.ts";
import type { MealPlanEntryRow, NewMealPlanEntryRow } from "../../../../db/schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { isUniqueViolation } from "../../../../core/services/auth/users.ts";
import { type DbLike, nowMs, withTransaction } from "../../../../core/services/households/support.ts";
import { loadRecipeRow } from "../recipes/recipes.service.ts";
import { toMealPlanEntry } from "./mappers.ts";

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

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
export async function listPlanEntries(
  db: DbLike,
  householdId: string,
  from: PlanDate,
  to: PlanDate,
): Promise<MealPlanEntry[]> {
  const rows = await db
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
    .orderBy(asc(mealPlanEntries.plannedOn), asc(mealPlanEntries.position));
  return rows.map((row) => toMealPlanEntry(row.entry, row.recipe));
}

/**
 * The latest `plannedOn` per recipe strictly before `before` — the picker's
 * "Zuletzt geplant". One grouped `max()` over the household's history; `plannedOn` is
 * `YYYY-MM-DD`, so the lexicographic max IS the latest date.
 */
export async function listLastPlanned(
  db: DbLike,
  householdId: string,
  before: PlanDate,
): Promise<Array<{ recipeId: string; plannedOn: PlanDate }>> {
  const rows = await db
    .select({ recipeId: mealPlanEntries.recipeId, plannedOn: max(mealPlanEntries.plannedOn) })
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.householdId, householdId), lt(mealPlanEntries.plannedOn, before)))
    .groupBy(mealPlanEntries.recipeId);
  return rows.flatMap((row) => (row.plannedOn ? [{ recipeId: row.recipeId, plannedOn: row.plannedOn }] : []));
}

/**
 * The raw entry inside `householdId`, or `undefined` for a cross-household id — scoped by
 * `and(eq(id), eq(householdId))` so a cross-household id answers 404 rather than leaking
 * (consumed by T4.2's `recordCooked` to verify a client-supplied
 * `mealPlanEntryId`, and by this file's own `requirePlanEntryRow`).
 */
export async function loadPlanEntryRow(
  db: DbLike,
  householdId: string,
  entryId: string,
): Promise<MealPlanEntryRow | undefined> {
  const [row] = await db
    .select()
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlanEntries.householdId, householdId)))
    .limit(1);
  return row;
}

/** `loadPlanEntryRow`, but 404s instead of returning `undefined` — the route shape. */
async function requirePlanEntryRow(
  db: DbLike,
  householdId: string,
  entryId: string,
): Promise<MealPlanEntryRow> {
  const row = await loadPlanEntryRow(db, householdId, entryId);
  if (!row) throw ApiError.notFound("server.plan.entryNotFound");
  return row;
}

/**
 * The entry (if any) that already puts `recipeId` on `plannedOn` — the ONLY place
 * a date-to-entry resolution happens. Takes the date as a parameter precisely
 * because the caller (T4.2's `recordCooked`) never derives one itself.
 */
export async function findPlanEntryForRecipeOnDay(
  db: DbLike,
  householdId: string,
  recipeId: string,
  plannedOn: PlanDate,
): Promise<MealPlanEntryRow | undefined> {
  const [row] = await db
    .select()
    .from(mealPlanEntries)
    .where(
      and(
        eq(mealPlanEntries.householdId, householdId),
        eq(mealPlanEntries.recipeId, recipeId),
        eq(mealPlanEntries.plannedOn, plannedOn),
      ),
    )
    .limit(1);
  return row;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

/** One past the highest `position` already on `plannedOn`, i.e. the tail slot. */
async function nextPositionOnDay(db: DbLike, householdId: string, plannedOn: PlanDate): Promise<number> {
  const [row] = await db
    .select({ value: max(mealPlanEntries.position) })
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.householdId, householdId), eq(mealPlanEntries.plannedOn, plannedOn)));
  return (row?.value ?? -1) + 1;
}

/**
 * Plans `input.recipeId` on `input.plannedOn`. POST is idempotent: planning the
 * same recipe on the same day twice returns the EXISTING row with
 * `created: false` and applies the second call's `servings`, rather than raising
 * a duplicate. Written as a pre-check inside the transaction plus a caught
 * UNIQUE-constraint error, in that order — the pre-check keeps the normal path
 * readable, the catch is what makes a race between two members correct.
 */
export async function createPlanEntry(
  db: Database,
  householdId: string,
  userId: string,
  input: CreateMealPlanEntryRequest,
): Promise<{ entry: MealPlanEntry; created: boolean }> {
  // 404 for a recipe outside the household — reuse the existing lookup, never re-query.
  const recipeRow = await loadRecipeRow(db, householdId, input.recipeId);

  const { row, created: isNew } = await withTransaction(db, async (tx) => {
    const existing = await findPlanEntryForRecipeOnDay(tx, householdId, input.recipeId, input.plannedOn);
    if (existing) {
      const patch = { servings: input.servings ?? null, updatedAt: nowMs() };
      await tx.update(mealPlanEntries).set(patch).where(eq(mealPlanEntries.id, existing.id));
      return { row: { ...existing, ...patch }, created: false };
    }

    const [dayCountRow] = await tx
      .select({ value: count() })
      .from(mealPlanEntries)
      .where(and(eq(mealPlanEntries.householdId, householdId), eq(mealPlanEntries.plannedOn, input.plannedOn)));
    if (Number(dayCountRow?.value ?? 0) >= PLAN_LIMITS.entriesPerDay) {
      throw ApiError.conflict("meal_plan_day_full", {
        key: "server.plan.dayFull",
        values: { max: PLAN_LIMITS.entriesPerDay },
      });
    }

    const newRow: MealPlanEntryRow = {
      id: crypto.randomUUID(),
      householdId,
      recipeId: input.recipeId,
      plannedOn: input.plannedOn,
      position: await nextPositionOnDay(tx, householdId, input.plannedOn),
      servings: input.servings ?? null,
      cookedAt: null,
      createdBy: userId,
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    try {
      await tx.insert(mealPlanEntries).values(newRow);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Race: another request planned the same (household, day, recipe) between our
      // pre-check and this insert. The loser applies the same patch the winner
      // would have got from a second POST, rather than surfacing the race.
      const race = await findPlanEntryForRecipeOnDay(tx, householdId, input.recipeId, input.plannedOn);
      if (!race) throw error;
      const patch = { servings: input.servings ?? null, updatedAt: nowMs() };
      await tx.update(mealPlanEntries).set(patch).where(eq(mealPlanEntries.id, race.id));
      return { row: { ...race, ...patch }, created: false };
    }
    return { row: newRow, created: true };
  });

  return { entry: toMealPlanEntry(row, recipeRow), created: isNew };
}

/**
 * Moving `plannedOn` is the drag-and-drop: it re-tails `position` on the TARGET
 * day unless `position` was sent explicitly (otherwise a moved entry would inherit
 * a position from the day it left and land mid-column on the new one). Moving
 * onto a day that already holds the same recipe never silently merges the two
 * entries — it is a 409, same as the create path's idempotent POST is not.
 */
export async function updatePlanEntry(
  db: Database,
  householdId: string,
  entryId: string,
  input: UpdateMealPlanEntryRequest,
): Promise<MealPlanEntry> {
  return withTransaction(db, async (tx) => {
    const row = await requirePlanEntryRow(tx, householdId, entryId);
    const movingDay = input.plannedOn !== undefined && input.plannedOn !== row.plannedOn;
    const targetDay = input.plannedOn ?? row.plannedOn;

    if (movingDay) {
      const [clash] = await tx
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
        .limit(1);
      if (clash) throw ApiError.conflict("conflict", "server.plan.alreadyPlanned");

      const [dayCountRow] = await tx
        .select({ value: count() })
        .from(mealPlanEntries)
        .where(and(eq(mealPlanEntries.householdId, householdId), eq(mealPlanEntries.plannedOn, targetDay)));
      if (Number(dayCountRow?.value ?? 0) >= PLAN_LIMITS.entriesPerDay) {
        throw ApiError.conflict("meal_plan_day_full", {
          key: "server.plan.dayFull",
          values: { max: PLAN_LIMITS.entriesPerDay },
        });
      }
    }

    const patch: Partial<NewMealPlanEntryRow> = { updatedAt: nowMs() };
    if (input.plannedOn !== undefined) patch.plannedOn = input.plannedOn;
    patch.position = input.position ?? (movingDay ? await nextPositionOnDay(tx, householdId, targetDay) : row.position);
    if (input.servings !== undefined) patch.servings = input.servings;
    // note: no column to write to — see mappers.ts.

    await tx.update(mealPlanEntries).set(patch).where(eq(mealPlanEntries.id, entryId));
    const updated = await requirePlanEntryRow(tx, householdId, entryId);
    const recipeRow = await loadRecipeRow(tx, householdId, updated.recipeId);
    return toMealPlanEntry(updated, recipeRow);
  });
}

/** Unplans an entry. Any member may remove any entry — see the file header. */
export async function deletePlanEntry(db: DbLike, householdId: string, entryId: string): Promise<void> {
  await requirePlanEntryRow(db, householdId, entryId);
  await db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, entryId));
}
