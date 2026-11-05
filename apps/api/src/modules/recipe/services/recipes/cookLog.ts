/**
 * "Gekocht" — cook tracking. THE ONLY WRITER of `recipes.last_cooked_at`
 * (`recordCooked`, `undoCooked`); `recipePatch()` in `recipes.service.ts` must never
 * grow a branch for it, the same rule that keeps `updateUser()` from patching
 * `email_verified_at`. See the column comment in `db/schema.ts` for why the fact is
 * denormalised rather than a per-query `max()`.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9). `CookLog` runs on the
 * current executor of `Database` (inside `Database.transaction` that is the open transaction), reads the `Clock` for
 * the cook time and the undo window, and refuses with the tagged family.
 */
import type { MarkCookedRequest, RecipeCookedResponse } from "@toon/shared";
import { and, desc, eq, max } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { mealPlanEntries, recipeCookLog, recipes } from "../../../../db/schema.ts";
import type { MealPlanEntryRow } from "../../../../db/schema.ts";
import { NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { toMealPlanEntry } from "../plan/mappers.ts";
import { MealPlan } from "../plan/plan.service.ts";
import { Recipes } from "./recipes.service.ts";

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

/** "Gekocht": the cook log and its undo window. */
export class CookLog extends Context.Service<
  CookLog,
  {
    /**
     * Appends a `recipe_cook_log` row, bumps `recipes.last_cooked_at`, and stamps the
     * plan entry the client names — or the one for `plannedOn`, if and only if a date
     * was sent. NEVER guesses "today": no `plannedOn` and no `mealPlanEntryId` means no
     * entry is touched and `mealPlanEntry` comes back `null` (see calendar.ts).
     */
    readonly recordCooked: (
      householdId: string,
      userId: string,
      recipeId: string,
      input: MarkCookedRequest,
    ) => Effect.Effect<RecipeCookedResponse, NotFound | DatabaseError>;
    /**
     * Undoes the CALLER's own most recent cook of this recipe, if it is younger than
     * `COOK_UNDO_WINDOW_MS` (compared against the `Clock`). Clears the plan entry's `cooked_at` when the undone row
     * was the one that stamped it (a later cook — by anyone — that restamped the same
     * entry must survive), and RECOMPUTES `recipes.last_cooked_at` from
     * `max(cooked_at)` of what remains (`null` when nothing does) — unlike
     * `recordCooked`'s plain `set`, the deleted row need not have been the newest if
     * another member cooked the same recipe in between.
     */
    readonly undoCooked: (
      householdId: string,
      userId: string,
      recipeId: string,
    ) => Effect.Effect<void, NotFound | DatabaseError>;
  }
>()("toon/api/modules/recipe/services/recipes/cookLog/CookLog") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const recipeService = yield* Recipes;
      const plan = yield* MealPlan;

      const recordCooked = Effect.fn("CookLog.recordCooked")(function* (
        householdId: string,
        userId: string,
        recipeId: string,
        input: MarkCookedRequest,
      ) {
        return yield* database.transaction(
          Effect.gen(function* () {
            const recipeRow = yield* recipeService.loadRecipeRow(householdId, recipeId);
            const cookedAt = yield* Clock.currentTimeMillis;

            // Resolve the entry to stamp: an explicit id wins and must actually name THIS
            // recipe (a mistargeted id is a client bug, so it 404s rather than silently
            // doing nothing); otherwise the entry for `plannedOn`, but ONLY when the
            // client sent one — the server never derives a date itself.
            let entryRow: MealPlanEntryRow | undefined;
            if (input.mealPlanEntryId) {
              entryRow = yield* plan.loadPlanEntryRow(householdId, input.mealPlanEntryId);
              if (!entryRow || entryRow.recipeId !== recipeId) {
                return yield* new NotFound({ text: "server.plan.entryNotFound" });
              }
            } else if (input.plannedOn) {
              entryRow = yield* plan.findPlanEntryForRecipeOnDay(householdId, recipeId, input.plannedOn);
            }

            yield* database.use((db) =>
              db.insert(recipeCookLog).values({
                id: crypto.randomUUID(),
                recipeId,
                householdId,
                cookedBy: userId,
                cookedAt,
                mealPlanEntryId: entryRow?.id ?? null,
              }),
            );

            if (entryRow) {
              const stampedId = entryRow.id;
              yield* database.use((db) =>
                db.update(mealPlanEntries).set({ cookedAt, updatedAt: cookedAt }).where(eq(mealPlanEntries.id, stampedId)),
              );
              entryRow = { ...entryRow, cookedAt, updatedAt: cookedAt };
            }

            // A plain `set`, not a `max()`: `cookedAt` is the Clock's now and is therefore the
            // newest by construction — `undoCooked` is the one path that must recompute.
            // `recipes.updated_at` is deliberately NOT touched: "Cooked" is not an edit of
            // the recipe, and bumping it would reorder `?sort=newest` and make every cook
            // look like a content change to the offline cache.
            yield* database.use((db) => db.update(recipes).set({ lastCookedAt: cookedAt }).where(eq(recipes.id, recipeId)));

            return {
              recipeId,
              cookedAt: toIso(cookedAt),
              lastCookedAt: toIso(cookedAt),
              mealPlanEntry: entryRow ? toMealPlanEntry(entryRow, recipeRow) : null,
            } satisfies RecipeCookedResponse;
          }),
        );
      });

      const undoCooked = Effect.fn("CookLog.undoCooked")(function* (
        householdId: string,
        userId: string,
        recipeId: string,
      ) {
        yield* database.transaction(
          Effect.gen(function* () {
            yield* recipeService.loadRecipeRow(householdId, recipeId); // 404 for a recipe outside the household
            const cutoff = (yield* Clock.currentTimeMillis) - COOK_UNDO_WINDOW_MS;

            const [logRow] = yield* database.use((db) =>
              db
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
                .limit(1),
            );
            if (!logRow || logRow.cookedAt < cutoff) {
              return yield* new NotFound({ text: "server.recipes.nothingToUndo" });
            }

            yield* database.use((db) => db.delete(recipeCookLog).where(eq(recipeCookLog.id, logRow.id)));

            if (logRow.mealPlanEntryId) {
              const entry = yield* plan.loadPlanEntryRow(householdId, logRow.mealPlanEntryId);
              // Only clear the stamp if the row we just deleted was the one that set it.
              if (entry && entry.cookedAt === logRow.cookedAt) {
                const updatedAt = yield* Clock.currentTimeMillis;
                yield* database.use((db) =>
                  db.update(mealPlanEntries).set({ cookedAt: null, updatedAt }).where(eq(mealPlanEntries.id, entry.id)),
                );
              }
            }

            const [maxRow] = yield* database.use((db) =>
              db.select({ value: max(recipeCookLog.cookedAt) }).from(recipeCookLog).where(eq(recipeCookLog.recipeId, recipeId)),
            );
            yield* database.use((db) =>
              db
                .update(recipes)
                .set({ lastCookedAt: maxRow?.value ?? null })
                .where(eq(recipes.id, recipeId)),
            );
          }),
        );
      });

      return CookLog.of({ recordCooked, undoCooked });
    }),
  );
}
