/**
 * "Gekocht" — cook tracking. THE ONLY WRITER of `recipes.last_cooked_at`
 * (`recordCooked`, `undoCooked`); `recipePatch()` in `recipes.service.ts` must never
 * grow a branch for it, the same rule that keeps `updateUser()` from patching
 * `email_verified_at`. See the column comment in `db/schema.ts` for why the fact is
 * denormalised rather than a per-query `max()`.
 */
import type { MarkCookedRequest, RecipeCookedResponse } from "@toon/shared";
import { and, desc, eq, max } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import { mealPlanEntries, recipeCookLog, recipes } from "../../../../db/schema.ts";
import type { MealPlanEntryRow } from "../../../../db/schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { toIso, toIsoOrNull } from "../../../../lib/http.ts";
import { nowMs, withTransaction } from "../../../../core/services/households/support.ts";
import { toMealPlanEntry } from "../plan/mappers.ts";
import { findPlanEntryForRecipeOnDay, loadPlanEntryRow } from "../plan/plan.service.ts";
import { loadRecipeRow } from "./recipes.service.ts";

/**
 * How long after a "Gekocht" tap the caller may undo it — ~30 lines of API for a
 * one-tap irreversible write sitting next to "Cook mode" on a phone (R18). The web
 * side (T7.3's `usePlanEntryCookedUndo`, T8.4's `Rückgängig` button) drives its
 * countdown off the same figure; there is no shared constant for it because
 * `packages/shared/src/schemas/plan.ts` is a different task's file (T2.3) and this
 * number was decided after that task landed — keep the two literals in sync by
 * hand if either ever changes.
 */
export const COOK_UNDO_WINDOW_MS = 10 * 60 * 1000;

/**
 * Appends a `recipe_cook_log` row, bumps `recipes.last_cooked_at`, and stamps the
 * plan entry the client names — or the one for `plannedOn`, if and only if a date
 * was sent. NEVER guesses "today": no `plannedOn` and no `mealPlanEntryId` means no
 * entry is touched and `mealPlanEntry` comes back `null` (see calendar.ts).
 */
export async function recordCooked(
  db: Database,
  householdId: string,
  userId: string,
  recipeId: string,
  input: MarkCookedRequest,
): Promise<RecipeCookedResponse> {
  return withTransaction(db, async (tx) => {
    const recipeRow = await loadRecipeRow(tx, householdId, recipeId);
    const cookedAt = nowMs();

    // Resolve the entry to stamp: an explicit id wins and must actually name THIS
    // recipe (a mistargeted id is a client bug, so it 404s rather than silently
    // doing nothing); otherwise the entry for `plannedOn`, but ONLY when the
    // client sent one — the server never derives a date itself.
    let entryRow: MealPlanEntryRow | undefined;
    if (input.mealPlanEntryId) {
      entryRow = await loadPlanEntryRow(tx, householdId, input.mealPlanEntryId);
      if (!entryRow || entryRow.recipeId !== recipeId) {
        throw ApiError.notFound("server.plan.entryNotFound");
      }
    } else if (input.plannedOn) {
      entryRow = await findPlanEntryForRecipeOnDay(tx, householdId, recipeId, input.plannedOn);
    }

    await tx.insert(recipeCookLog).values({
      id: crypto.randomUUID(),
      recipeId,
      householdId,
      cookedBy: userId,
      cookedAt,
      mealPlanEntryId: entryRow?.id ?? null,
    });

    if (entryRow) {
      await tx
        .update(mealPlanEntries)
        .set({ cookedAt, updatedAt: cookedAt })
        .where(eq(mealPlanEntries.id, entryRow.id));
      entryRow = { ...entryRow, cookedAt, updatedAt: cookedAt };
    }

    // A plain `set`, not a `max()`: `cookedAt` is `nowMs()` and is therefore the
    // newest by construction — `undoCooked` is the one path that must recompute.
    // `recipes.updated_at` is deliberately NOT touched: "Cooked" is not an edit of
    // the recipe, and bumping it would reorder `?sort=newest` and make every cook
    // look like a content change to the offline cache.
    await tx.update(recipes).set({ lastCookedAt: cookedAt }).where(eq(recipes.id, recipeId));

    return {
      recipeId,
      cookedAt: toIso(cookedAt),
      lastCookedAt: toIso(cookedAt),
      mealPlanEntry: entryRow ? toMealPlanEntry(entryRow, recipeRow) : null,
    };
  });
}

/**
 * Undoes the CALLER's own most recent cook of this recipe, if it is younger than
 * `COOK_UNDO_WINDOW_MS`. Clears the plan entry's `cooked_at` when the undone row
 * was the one that stamped it (a later cook — by anyone — that restamped the same
 * entry must survive), and RECOMPUTES `recipes.last_cooked_at` from
 * `max(cooked_at)` of what remains (`null` when nothing does) — unlike
 * `recordCooked`'s plain `set`, the deleted row need not have been the newest if
 * another member cooked the same recipe in between.
 */
export async function undoCooked(db: Database, householdId: string, userId: string, recipeId: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await loadRecipeRow(tx, householdId, recipeId); // 404 for a recipe outside the household
    const cutoff = nowMs() - COOK_UNDO_WINDOW_MS;

    const [logRow] = await tx
      .select()
      .from(recipeCookLog)
      .where(
        and(
          eq(recipeCookLog.recipeId, recipeId),
          eq(recipeCookLog.householdId, householdId),
          eq(recipeCookLog.cookedBy, userId),
        ),
      )
      .orderBy(desc(recipeCookLog.cookedAt))
      .limit(1);
    if (!logRow || logRow.cookedAt < cutoff) {
      throw ApiError.notFound("server.recipes.nothingToUndo");
    }

    await tx.delete(recipeCookLog).where(eq(recipeCookLog.id, logRow.id));

    if (logRow.mealPlanEntryId) {
      const entry = await loadPlanEntryRow(tx, householdId, logRow.mealPlanEntryId);
      // Only clear the stamp if the row we just deleted was the one that set it.
      if (entry && entry.cookedAt === logRow.cookedAt) {
        await tx
          .update(mealPlanEntries)
          .set({ cookedAt: null, updatedAt: nowMs() })
          .where(eq(mealPlanEntries.id, entry.id));
      }
    }

    const [maxRow] = await tx
      .select({ value: max(recipeCookLog.cookedAt) })
      .from(recipeCookLog)
      .where(eq(recipeCookLog.recipeId, recipeId));
    await tx
      .update(recipes)
      .set({ lastCookedAt: maxRow?.value ?? null })
      .where(eq(recipes.id, recipeId));
  });
}
