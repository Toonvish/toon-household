import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem<Value extends string = string> {
  value: Value;
  label: ReactNode;
  /** Small count/badge rendered after the label. */
  badge?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<Value extends string = string> {
  items: ReadonlyArray<TabItem<Value>>;
  value: Value;
  onChange: (value: Value) => void;
  /** `segmented` (pill background, default) or `underline`. */
  variant?: "segmented" | "underline";
  /** Scrolls horizontally instead of shrinking when there are many tabs. */
  scrollable?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Controlled tab strip. Renders real `role="tab"` buttons with arrow-key support;
 * the panels stay the caller's responsibility (`{value === "x" && <Panel/>}`).
 */
export function Tabs<Value extends string = string>({
  items,
  value,
  onChange,
  variant = "segmented",
  scrollable = false,
  className,
  "aria-label": ariaLabel,
}: TabsProps<Value>) {
  const baseId = useId();

  function move(direction: 1 | -1) {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.value === value);
    const next = enabled[(index + direction + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        }
      }}
      className={cn(
        "flex gap-1",
        variant === "segmented" && "rounded-xl border border-line bg-surface p-1",
        variant === "underline" && "border-b border-line",
        scrollable && "no-scrollbar overflow-x-auto",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            id={`${baseId}-${item.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-3 text-control font-semibold whitespace-nowrap transition-colors duration-150 disabled:opacity-50 [&_svg]:size-4",
              scrollable && "flex-none",
              variant === "segmented" &&
                (active
                  ? "rounded-control bg-brand-soft text-brand-soft-fg"
                  : "rounded-control text-fg-subtle hover:text-fg"),
              variant === "underline" &&
                (active
                  ? "-mb-px border-b-2 border-brand text-fg"
                  : "-mb-px border-b-2 border-transparent text-fg-muted hover:text-fg"),
            )}
          >
            {item.icon}
            {item.label}
            {item.badge !== undefined ? (
              <span className="text-fg-subtle">· {item.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
