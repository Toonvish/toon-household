import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ChipSize = "sm" | "md";

const sizes: Record<ChipSize, string> = {
  sm: "min-h-9",
  md: "min-h-10",
};

export interface ChipProps {
  label: string;
  /** Omitted renders a non-interactive `<span>`. */
  onSelect?: () => void;
  /** The design's leading `+`. */
  leadingIcon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  size?: ChipSize;
  /** 1d's "right-click or long-press to hide" affordance. */
  onContextMenu?: MouseEventHandler<HTMLButtonElement | HTMLSpanElement>;
  className?: string;
}

/**
 * A pill suggestion/filter chip — "Häufig gekauft" (`FrequentlyUsed`), the tag scroller,
 * the phone group switcher. THERE IS NO `onDismiss` AND NO PER-CHIP `×`: the design's
 * stated fix for "Frequently bought" clutter is that hiding moves to a context-menu /
 * long-press, so re-adding a dismiss slot here would let the old affordance creep back
 * in (SPEC §4.6). `min-h-9` is below the repo's 44px touch floor and that is accepted on
 * purpose — a chip is a shortcut whose action is always also reachable from the
 * always-present add bar next to it. Do not "fix" this to `min-h-11`.
 */
export function Chip({
  label,
  onSelect,
  leadingIcon,
  selected = false,
  disabled = false,
  size = "sm",
  onContextMenu,
  className,
}: ChipProps) {
  // The two colour sets are EXCLUSIVE, never stacked: `cn` is plain clsx and Tailwind
  // emits same-property utilities alphabetically, so a stacked `bg-surface` would
  // silently win over `bg-brand-soft` and a selected chip would look unselected.
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full border pr-3.5 pl-2.5 text-control font-medium",
    "transition-colors duration-150",
    sizes[size],
    selected
      ? "border-brand bg-brand-soft text-brand-soft-fg"
      : "border-line bg-surface text-fg-body hover:border-brand hover:text-brand-soft-fg",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    disabled && "pointer-events-none opacity-55",
    className,
  );

  if (!onSelect) {
    return (
      <span className={classes} onContextMenu={onContextMenu}>
        {leadingIcon}
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      disabled={disabled}
      aria-pressed={selected}
      className={classes}
    >
      {leadingIcon}
      {label}
    </button>
  );
}
