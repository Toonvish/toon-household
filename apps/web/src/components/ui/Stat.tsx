import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StatTone = "default" | "success";
export type StatSize = "sm" | "md";

const toneClasses: Record<StatTone, string> = {
  default: "text-fg",
  success: "text-success-soft-fg",
};

const sizeClasses: Record<StatSize, string> = {
  sm: "text-display-sm",
  md: "text-display-md",
};

export interface StatProps {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  /** `sm` (phone) / `md` (desktop). Default `sm` — pass `size="md"` from a desktop layout. */
  size?: StatSize;
  className?: string;
}

/**
 * One label/value pair — "Servings", "Last cooked", the recipe detail stat row and the
 * planner's weekly counts. Replaces the hand-rolled `<dt>/<dd>` in
 * `RecipeDetailPage.tsx`. `min-w-0` is on the root deliberately: a `Stat` is almost
 * always a grid/flex item and without it a long value pushes its neighbours off a
 * 390px screen (CLAUDE.md's `min-w-0` gotcha).
 */
export function Stat({ label, value, tone = "default", size = "sm", className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="eyebrow block text-fg-faint">{label}</span>
      <span className={cn("font-display font-medium tabular-nums", sizeClasses[size], toneClasses[tone])}>
        {value}
      </span>
    </div>
  );
}

export interface StatRowProps {
  children: ReactNode;
  /** `4` renders the phone grid; omitted renders the desktop flex row. */
  columns?: number;
  /** The design's border-top/border-bottom pair around the row. */
  divided?: boolean;
  className?: string;
}

export function StatRow({ children, columns, divided = false, className }: StatRowProps) {
  return (
    <div
      className={cn(
        columns ? "grid gap-2" : "flex flex-wrap gap-7",
        divided && "border-y border-surface-2 py-3.5",
        className,
      )}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {children}
    </div>
  );
}
