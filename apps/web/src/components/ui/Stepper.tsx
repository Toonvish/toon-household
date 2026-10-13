import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

export type StepperSize = "sm" | "md";

const buttonSizes: Record<StepperSize, string> = {
  sm: "size-9",
  md: "size-10",
};

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number | ((value: number) => number);
  /** Defaults to `String(value)`. */
  format?: (value: number) => string;
  /** Required: aria-labels for the two buttons. */
  decreaseLabel: string;
  increaseLabel: string;
  /** Optional accessible name for the live value itself. */
  srLabel?: string;
  /** `sm` (36px, desktop) / `md` (40px, phone). */
  size?: StepperSize;
  className?: string;
}

/**
 * The rectangular `− value +` frame drawn on the recipe detail screen (desktop) and the
 * planner's serving picker (phone). `ServingsScaler` delegates to this for the frame
 * only and keeps its own halves-below-4 stepping, clamping, `formatQuantity` and
 * reset-to-base semantics — the split that keeps `packages/shared`'s `scaleIngredients`
 * the single source of the scaling arithmetic (CLAUDE.md).
 *
 * `useId()` generates the label id rather than a constant: two steppers can be on
 * screen at once (the recipe page plus the "zur Einkaufsliste" dialog), and a duplicate
 * id would break both labels.
 */
export function Stepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  format = (v) => String(v),
  decreaseLabel,
  increaseLabel,
  srLabel,
  size = "sm",
  className,
}: StepperProps) {
  const labelId = useId();
  const delta = typeof step === "function" ? step(value) : step;

  return (
    <div className={cn("inline-flex items-center rounded-control border border-line bg-surface-inset", className)}>
      {srLabel != null ? (
        <span id={labelId} className="sr-only">
          {srLabel}
        </span>
      ) : null}
      <button
        type="button"
        className={cn(
          "flex items-center justify-center rounded-l-control text-fg-muted hover:text-fg disabled:opacity-40",
          buttonSizes[size],
        )}
        onClick={() => onChange(Math.max(min, value - delta))}
        disabled={value <= min}
        aria-label={decreaseLabel}
      >
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <output
        aria-live="polite"
        aria-labelledby={srLabel != null ? labelId : undefined}
        className="min-w-9 px-1 text-center text-control font-semibold tabular-nums text-fg"
      >
        {format(value)}
      </output>
      <button
        type="button"
        className={cn(
          "flex items-center justify-center rounded-r-control text-fg-muted hover:text-fg disabled:opacity-40",
          buttonSizes[size],
        )}
        onClick={() => onChange(Math.min(max, value + delta))}
        disabled={value >= max}
        aria-label={increaseLabel}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
