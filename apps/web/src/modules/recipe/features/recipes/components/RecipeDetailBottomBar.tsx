/**
 * RecipeDetailBottomBar — the phone detail screen's sticky footer (A04 §6.2):
 * "Kochmodus" (a read, so it stays enabled in every state) plus the 52px "Gekocht"
 * square, which becomes an undo square for `COOK_UNDO_WINDOW_MS` after a successful
 * tap (R18).
 *
 * `.bottom-tabbar`, never `bottom-0` — `BottomTabBar` is `fixed inset-x-0 bottom-0
 * z-30` and `AppShell` renders it AFTER `<main>`, so a `bottom-0` bar here would be
 * painted underneath it. This bar is also INSET, not full-bleed (no `-mx-*`, no
 * `-mb-4`): `1f` draws it at `left:20px;right:20px;bottom:24px`, which is exactly
 * the page gutter plus the 1rem `pb-tabbar` already reserves — see the page root's
 * unbroken flex chain (RecipeDetailPage.tsx) for the `flex-1` spacer this bar
 * needs above it.
 */
import { Check, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export interface RecipeDetailBottomBarProps {
  onCookMode: () => void;
  cookModeDisabled?: boolean;
  /** True within `COOK_UNDO_WINDOW_MS` of the caller's own last "Gekocht" tap. */
  cookedRecently: boolean;
  onMarkCooked: () => void;
  onUndoCooked: () => void;
  /** `useCanMutate()` — "Gekocht" is online-only (R38), unlike "Kochmodus". */
  canMutateCooked: boolean;
  cookedReason?: string;
  cookedPending?: boolean;
}

export function RecipeDetailBottomBar({
  onCookMode,
  cookModeDisabled,
  cookedRecently,
  onMarkCooked,
  onUndoCooked,
  canMutateCooked,
  cookedReason,
  cookedPending,
}: RecipeDetailBottomBarProps) {
  const t = useT();
  return (
    <div
      data-print="hide"
      className="sticky bottom-tabbar z-20 flex gap-2.5 pt-2"
    >
      <Button
        size="lg"
        fullWidth
        disabled={cookModeDisabled}
        onClick={onCookMode}
        leftIcon={<Play className="fill-current" />}
        className="rounded-2xl font-bold shadow-pop"
      >
        {t("recipe.recipes.detail.cookModeAction")}
      </Button>
      <button
        type="button"
        disabled={!canMutateCooked || cookedPending}
        title={cookedReason}
        aria-label={
          cookedRecently ? t("recipe.recipes.detail.cookedUndo") : t("recipe.recipes.detail.markCookedAriaLabel")
        }
        onClick={cookedRecently ? onUndoCooked : onMarkCooked}
        className={cn(
          "grid size-13 shrink-0 place-items-center rounded-2xl border shadow-pop transition-colors duration-150",
          "disabled:pointer-events-none disabled:opacity-55",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          cookedRecently
            ? "border-line bg-surface text-fg-muted"
            : "border-success-soft bg-success-soft text-success-soft-fg",
        )}
      >
        {cookedRecently ? (
          <RotateCcw aria-hidden="true" className="size-5" />
        ) : (
          <Check aria-hidden="true" strokeWidth={2.6} className="size-5" />
        )}
      </button>
    </div>
  );
}
