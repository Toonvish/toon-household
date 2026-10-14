/**
 * "Portionen ändern" — a day card's `ActionMenu` item opens this over the entry's
 * `ServingsScaler` (the same stepper the recipe detail page and
 * `AddRecipeToListDialog` use, so scaling reads identically everywhere it appears).
 *
 * TWO WAYS OUT, ON PURPOSE. `servings` is nullable precisely so "use the recipe's
 * own number" is expressible (`packages/shared/src/schemas/plan.ts`), and writing
 * the recipe's own value into that column would be the thing the nullable column
 * exists to avoid — so "Speichern" sends `null` when the stepper lands back on the
 * base value, and "Rezept-Portionen verwenden" is a SEPARATE one-tap reset that
 * PATCHes `servings: null` immediately rather than requiring the cook to first
 * drag the stepper back down and then press Save.
 *
 * No success toast: closing the dialog IS the feedback (same as the recipe
 * detail's inline stepper), and `recipe.plan.toast.*` has no key for "servings changed" —
 * only the entry's OWN failure needs a toast, so the dialog can stay open and be
 * retried.
 */
import { useEffect, useRef, useState } from "react";
import type { MealPlanEntry } from "@toon/shared";
import { Button, Dialog, useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatShortWeekdayDate } from "@/modules/recipe/lib/format";
import { ServingsScaler } from "@/modules/recipe/features/recipes/components/ServingsScaler";
import { usePlanEntryUpdate } from "../lib/queries";

export interface PlanServingsDialogProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  entry: MealPlanEntry;
}

export function PlanServingsDialog({ open, onClose, householdId, entry }: PlanServingsDialogProps) {
  const t = useT();
  const toast = useToast();
  const update = usePlanEntryUpdate(householdId);

  // The recipe's own servings, falling back to 1 for the rare recipe that never
  // recorded an amount — the stepper needs SOME base to reset to.
  const baseValue =
    typeof entry.recipe.servingsAmount === "number" && entry.recipe.servingsAmount > 0
      ? entry.recipe.servingsAmount
      : 1;
  const [value, setValue] = useState(entry.servings ?? baseValue);

  // Re-seed once per opening, not on every render — a background refetch while the
  // dialog is open must not stomp on a drag the cook is mid-way through (same
  // discipline as `AddRecipeToListDialog`'s `opened` ref).
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setValue(entry.servings ?? baseValue);
  }, [open, entry.servings, baseValue]);

  function save() {
    update.mutate(
      { entryId: entry.id, patch: { servings: value === baseValue ? null : value } },
      { onSuccess: onClose, onError: (error) => toast.fromError(error, t("recipe.plan.toast.failed")) },
    );
  }

  function resetToRecipe() {
    update.mutate(
      { entryId: entry.id, patch: { servings: null } },
      { onSuccess: onClose, onError: (error) => toast.fromError(error, t("recipe.plan.toast.failed")) },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.plan.servings.title", { day: formatShortWeekdayDate(entry.plannedOn) })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={resetToRecipe} disabled={update.isPending} fullWidth>
            {t("recipe.plan.servings.reset")}
          </Button>
          <Button onClick={save} loading={update.isPending} fullWidth>
            {t("recipe.plan.servings.submit")}
          </Button>
        </>
      }
    >
      <ServingsScaler
        value={value}
        baseValue={baseValue}
        unit={entry.recipe.servingsUnit}
        onChange={setValue}
        size="md"
      />
    </Dialog>
  );
}
