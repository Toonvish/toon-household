import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type IconButtonVariant = "ghost" | "surface" | "brand" | "danger" | "scrim";
export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonShape = "square" | "circle";

const variants: Record<IconButtonVariant, string> = {
  ghost: "text-fg hover:bg-surface-2",
  surface: "bg-surface border border-line text-fg hover:bg-surface-2",
  brand: "bg-brand text-brand-fg hover:bg-brand-hover shadow-soft",
  danger: "text-danger hover:bg-danger-soft",
  /** `--bg` at 70% — the artboard's `rgba(23,18,15,.7)` scrim over a hero photo. */
  scrim: "bg-bg/70 text-fg backdrop-blur-sm hover:bg-bg/85",
};

/** Sizes stay 36/44/52 — the repo's 44px touch floor, no 40px entry (R14). */
const sizes: Record<IconButtonSize, string> = {
  sm: "size-9 [&_svg]:size-4",
  md: "size-11 [&_svg]:size-5",
  lg: "size-13 [&_svg]:size-6",
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Required: becomes aria-label + title. Icon-only controls need a name. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** `circle` for a control floating on a photo; `square` (default) everywhere else. */
  shape?: IconButtonShape;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    variant = "ghost",
    size = "md",
    shape = "square",
    loading = false,
    className,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled ?? loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-150",
        shape === "circle" ? "rounded-full" : "rounded-control",
        "active:scale-95 disabled:pointer-events-none disabled:opacity-55",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" label="" /> : icon}
    </button>
  );
});
