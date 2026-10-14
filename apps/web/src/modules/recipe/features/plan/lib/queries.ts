/**
 * TanStack Query hooks for the meal planner ("Wochenplan").
 *
 * PLANNER WRITES ARE ONLINE-ONLY, and that is a deliberate mirror of the cards
 * feature, not of the shopping list. `useCanMutate()` (false while offline) is the
 * right gate for every screen built on top of these hooks — the opposite of the
 * shopping screens, which must not use it because their writes queue and replay.
 * A queued offline mutation the server would 403 must never enter an outbox, which
 * is the other half of why none of the five mutations below is registered with
 * `setMutationDefaults`: there is no outbox to register them with.
 *
 * All five are therefore ordinary `useMutation` calls — no `mutationId`, no
 * persisted defaults — and every one invalidates through
 * `invalidateAfterPlanMutation`, which refreshes every mounted week range for the
 * household plus the shopping list's "from this week's plan" diff.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMealPlanEntryRequest,
  MealPlanEntry,
  PlanDate,
  RecipeCookedResponse,
  UpdateMealPlanEntryRequest,
} from "@toon/shared";
import { planWeek } from "@toon/shared";
import { useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import {
  createPlanEntry,
  deletePlanEntry,
  markRecipeCooked,
  undoRecipeCooked,
  updatePlanEntry,
} from "@/modules/recipe/lib/api";
import { invalidateAfterPlanMutation, lastPlannedQuery, planQuery } from "@/modules/recipe/lib/queries";

/**
 * A full Mon..Sun week around `weekStart` (which need not itself be a Monday —
 * `planWeek()` normalises). `offlineFirst` (see `planQuery`) so the library's week
 * strip and this screen both survive a cold start with no signal.
 */
export function usePlanWeek(householdId: string, weekStart: PlanDate) {
  const week = planWeek(weekStart);
  return useQuery(planQuery(householdId, { from: week[0]!, to: week[6]! }));
}

/**
 * `recipeId -> plannedOn` of the latest day each recipe was planned strictly
 * before `day`. `null` householdId (picker closed) fetches nothing.
 */
export function useLastPlanned(householdId: string | null, day: PlanDate) {
  return useQuery({
    ...lastPlannedQuery(householdId ?? "", day),
    enabled: householdId !== null,
    select: (data) => new Map(data.items.map((item) => [item.recipeId, item.plannedOn])),
  });
}

/** Plans a recipe on a day. Idempotent server-side (201 new / 200 already planned). */
export function usePlanEntryCreate(householdId: string) {
  const qc = useQueryClient();
  return useMutation<MealPlanEntry, Error, CreateMealPlanEntryRequest>({
    mutationFn: async (body) => (await createPlanEntry(householdId, body)).entry,
    onSuccess: async () => {
      await invalidateAfterPlanMutation(qc, householdId);
    },
  });
}

/** Moves an entry to another day (drag-and-drop), and/or changes its servings. */
export function usePlanEntryUpdate(householdId: string) {
  const qc = useQueryClient();
  return useMutation<
    MealPlanEntry,
    Error,
    { entryId: string; patch: UpdateMealPlanEntryRequest }
  >({
    mutationFn: async ({ entryId, patch }) => (await updatePlanEntry(householdId, entryId, patch)).entry,
    onSuccess: async () => {
      await invalidateAfterPlanMutation(qc, householdId);
    },
  });
}

/** Unplans an entry. Any member may remove any entry (routes/plan.ts). */
export function usePlanEntryDelete(householdId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (entryId) => deletePlanEntry(householdId, entryId),
    onSuccess: async () => {
      await invalidateAfterPlanMutation(qc, householdId);
    },
  });
}

/**
 * "Gekocht" from the planner: unlike `POST /api/cards/:id/used`, this is NOT
 * fire-and-forget — a failed write here does not have a barcode on screen that must
 * stay legible, so a genuine failure gets a toast (`recipe.plan.toast.failed`) instead of
 * being swallowed.
 */
export function usePlanEntryCooked(householdId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation<
    RecipeCookedResponse,
    Error,
    { recipeId: string; mealPlanEntryId: string }
  >({
    mutationFn: ({ recipeId, mealPlanEntryId }) =>
      markRecipeCooked(householdId, recipeId, { mealPlanEntryId }),
    onSuccess: async () => {
      await invalidateAfterPlanMutation(qc, householdId);
    },
    onError: (error) => {
      toast.fromError(error, t("recipe.plan.toast.failed"));
    },
  });
}

/**
 * Undoes the caller's own most recent "Gekocht" tap for this recipe, within the
 * server's short undo window (R18, `COOK_UNDO_WINDOW_MS`). Ships here so the
 * affordances T7.4 (a day card's `ActionMenu`) and T8.4 (the "Gekocht" ->
 * "Rückgängig" swap and the success toast's action slot) have a hook to call — an
 * endpoint with no caller is dead code, and this is its placement (R18, amended).
 * Same terms as `usePlanEntryCooked`: an ordinary online mutation, failure reported
 * with a toast rather than swallowed.
 */
export function usePlanEntryCookedUndo(householdId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation<void, Error, { recipeId: string }>({
    mutationFn: ({ recipeId }) => undoRecipeCooked(householdId, recipeId),
    onSuccess: async () => {
      await invalidateAfterPlanMutation(qc, householdId);
    },
    onError: (error) => {
      toast.fromError(error, t("recipe.plan.toast.failed"));
    },
  });
}
