/**
 * Wire mappers for the meal planner: the slim recipe a plan card renders and the
 * entry envelope around it.
 *
 * `note` is not mapped: `apps/api/src/db/schema.ts`'s `meal_plan_entries` table
 * carries no `note` column (A02 §2.1 sketched one; T3.1 dropped it — no artboard
 * draws it and dead schema is how a second, differently-shaped column gets added
 * later). `packages/shared/src/schemas/plan.ts` still types the field as
 * `nullish()` for a future migration, so `null` here parses cleanly; it just has
 * nowhere to come from yet.
 */
import type { MealPlanEntry, PlanRecipe } from "@toon/shared";
import type { MealPlanEntryRow, RecipeRow } from "../../../../db/schema.ts";
import { toIso, toIsoOrNull } from "../../../../lib/http.ts";
import { signUploadUrl } from "../../../../lib/uploadUrls.ts";
import { listImageUrlFor } from "../../../../core/services/media/thumbnails.ts";

/** The slim recipe a planner card renders: thumb, title, `meta`. */
export function toPlanRecipe(row: RecipeRow): PlanRecipe {
  return {
    id: row.id,
    title: row.title,
    // Signed, and the DERIVED thumbnail for a hosted upload — a planner card is a
    // list image, never the full-size `imageUrl` (CLAUDE.md thumbnail gotcha). An
    // EXTERNAL hero image has no derivative and this DTO has no `imageUrl` to fall
    // back to, so `listImageUrlFor` hands the original through in that one case.
    thumbnailUrl: signUploadUrl(listImageUrlFor(row.imageUrl)),
    totalMinutes: row.totalMinutes,
    servingsAmount: row.servingsAmount,
    servingsUnit: row.servingsUnit,
  };
}

/**
 * `plannedOn` passes through VERBATIM — it is already the wire format
 * (`YYYY-MM-DD`). Putting it through `toIso()` would turn a calendar date into an
 * instant and hand the client a `T00:00:00.000Z` it would mis-render west of
 * Greenwich (see the `meal_plan_entries` comment in db/schema.ts).
 */
export function toMealPlanEntry(row: MealPlanEntryRow, recipe: RecipeRow): MealPlanEntry {
  return {
    id: row.id,
    householdId: row.householdId,
    recipeId: row.recipeId,
    plannedOn: row.plannedOn,
    position: row.position,
    servings: row.servings,
    note: null,
    cookedAt: toIsoOrNull(row.cookedAt),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    recipe: toPlanRecipe(recipe),
  };
}
