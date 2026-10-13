import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SectionHeaderTone = "faint" | "success" | "accent";

const tones: Record<SectionHeaderTone, string> = {
  faint: "text-fg-faint",
  success: "text-success-soft-fg",
  accent: "text-accent-strong",
};

export interface SectionHeaderProps {
  /** Rendered through `.eyebrow`. */
  title: string;
  tone?: SectionHeaderTone;
  /** Right of the rule, e.g. an item count. */
  count?: ReactNode;
  /** Right of the rule, e.g. "Clear bought". */
  action?: ReactNode;
  /** So a section can `aria-labelledby` this header. */
  id?: string;
  className?: string;
}

/**
 * A hairline-rule section heading — "To buy" / "Bought today" on the shopping list, and
 * anywhere else a screen needs a heading that is not a card heading. `CardHeader` cannot
 * serve this: it has no rule, sits `mb-3` inside a card, and its title is the serif
 * display step, not the eyebrow. Lives in `components/ui/`, not `features/shopping/`
 * (R7) — the planner and the recipe detail screen need the same shape.
 */
export function SectionHeader({ title, tone = "faint", count, action, id, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2.5 pt-3.5 pb-1.5", className)}>
      <span id={id} className={cn("eyebrow", tones[tone])}>
        {title}
      </span>
      <span className="h-px flex-1 bg-surface-2" />
      {count != null ? <span className="text-xs text-fg-faint">{count}</span> : null}
      {action}
    </div>
  );
}
