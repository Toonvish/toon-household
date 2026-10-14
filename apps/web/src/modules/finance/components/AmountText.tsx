import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/modules/finance/lib/format";

export interface AmountTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  cents: number;
  /**
   * Negative amounts (Erstattungen, Gutschriften, Korrekturen) are always
   * coloured — CLAUDE.md: "Geld ist ganzzahliger Cent... Negative Beträge
   * sind gültig und bedeutungstragend." A negative sign alone is easy to
   * miss in a dense list; colour is the second, redundant signal.
   */
  colorNegative?: boolean;
  /** Prefixes a "+" on positive amounts (used for a debt increase, e.g. `finance.balance.breakdown`). */
  showPlusSign?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = {
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
  lg: "font-display text-display-lg font-medium",
  xl: "font-display text-display-4xl font-medium",
} as const;

/**
 * The one place a signed cent amount becomes text. `tabular-nums` keeps
 * amounts aligned in a list (the transaction list's right-hand column); the
 * shared `formatCurrency` never runs a value through `parseFloat` on the way
 * back out.
 */
export function AmountText({
  cents,
  colorNegative = true,
  showPlusSign = false,
  size = "md",
  className,
  ...rest
}: AmountTextProps) {
  const negative = cents < 0;
  const formatted = formatCurrency(cents);
  const withSign = showPlusSign && cents > 0 ? `+${formatted}` : formatted;
  return (
    <span
      className={cn(
        "tabular-nums",
        sizes[size],
        colorNegative && negative && "text-danger",
        className,
      )}
      {...rest}
    >
      {withSign}
    </span>
  );
}
