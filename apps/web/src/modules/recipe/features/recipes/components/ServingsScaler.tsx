/**
 * Servings stepper. Scaling itself happens with `scaleIngredients` from @toon/shared
 * (same function the API uses), so client and server always agree.
 *
 * The `− value +` frame is `Stepper` (`@/components/ui`) — this component keeps every
 * piece of its own semantics on top of it: the halves-below-4 `step()`, the `clamp()`,
 * `formatQuantity`, the noun resolution and the reset-to-base button. `packages/shared`'s
 * `scaleIngredients` stays the single source of the scaling arithmetic (CLAUDE.md).
 */
import { RotateCcw } from "lucide-react";
import { formatQuantity } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { Stepper, type StepperSize } from "@/components/ui/Stepper";

export interface ServingsScalerProps {
  /** Current servings shown. */
  value: number;
  /** Value stored on the recipe — enables the reset button. */
  baseValue: number;
  unit?: string | null;
  onChange: (value: number) => void;
  /** `sm` (recipe detail page, desktop) / `md` (the "zur Einkaufsliste" dialog, phone). */
  size?: StepperSize;
  className?: string;
}

/** Steps in halves below 4 portions, in whole numbers above. */
function step(value: number): number {
  return value < 4 ? 0.5 : 1;
}

function clamp(value: number): number {
  return Math.min(1000, Math.max(0.5, Math.round(value * 100) / 100));
}

export function ServingsScaler({
  value,
  baseValue,
  unit,
  onChange,
  size = "sm",
  className,
}: ServingsScalerProps) {
  const t = useT();
  const noun = typeof unit === "string" && unit.trim().length > 0 ? unit.trim() : t("common.servings.defaultUnit");
  const changed = Math.abs(value - baseValue) > 0.001;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Stepper
        value={value}
        onChange={(next) => onChange(clamp(next))}
        min={0.5}
        max={1000}
        step={step}
        format={(v) => `${formatQuantity(v)} ${noun}`}
        decreaseLabel={t("recipe.recipes.scaler.decreaseAction", { noun })}
        increaseLabel={t("recipe.recipes.scaler.increaseAction", { noun })}
        srLabel={t("recipe.recipes.scaler.srLabel", { noun })}
        size={size}
      />
      {changed ? (
        <button
          type="button"
          onClick={() => onChange(baseValue)}
          className="tap inline-flex items-center gap-1 rounded-full px-2 text-sm text-brand hover:text-brand-hover"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {t("recipe.recipes.scaler.resetAction")}
        </button>
      ) : null}
    </div>
  );
}
