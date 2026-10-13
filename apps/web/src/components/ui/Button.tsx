import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "accent"
  | "success"
  | "dashed";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 rounded-control " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 " +
  "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-55 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The design paints every filled button at 700 weight; quiet ones stay 600. */
const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg font-bold hover:bg-brand-hover",
  secondary: "bg-surface-2 text-fg font-semibold hover:bg-line",
  outline: "border border-line-strong bg-surface text-fg font-semibold hover:bg-surface-2",
  ghost: "text-fg font-semibold hover:bg-surface-2",
  danger: "bg-danger text-danger-fg font-bold hover:bg-danger-hover",
  accent: "bg-accent text-[#241d18] font-bold hover:brightness-105",
  success: "border border-success/40 bg-success-soft text-success-soft-fg font-semibold hover:border-success",
  dashed:
    "border border-dashed border-line-strong bg-transparent text-fg-muted font-semibold hover:border-brand hover:text-fg",
};

/**
 * Every size keeps a >=44px touch target except `sm`, which is for dense toolbars —
 * the design's 38px desktop toolbar buttons use `size="sm"`, its 40/42px buttons round
 * up to the 44/52px floor `md`/`lg` already sit at.
 */
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-control",
  md: "min-h-11 px-4 text-control",
  lg: "min-h-13 px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks. */
  loading?: boolean;
  /** Stretches to the container width — the default for mobile forms. */
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/** Class list of a button, e.g. for `<Link className={buttonClasses({variant:"primary"})}>`. */
export function buttonClasses(
  options: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {},
): string {
  const { variant = "primary", size = "md", fullWidth, className } = options;
  return cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    children,
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
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner size="sm" label="" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
