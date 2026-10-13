import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Required when no visible `label` is rendered. */
  "aria-label"?: string;
}

/**
 * Accessible toggle built on a real checkbox input, so it works with form
 * autofill, VoiceOver and keyboard out of the box. Row height >= 44px.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-11 cursor-pointer items-center justify-between gap-4",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-control font-medium text-fg">{label}</span> : null}
          {description ? (
            <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>
          ) : null}
        </span>
      ) : null}
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span
          aria-hidden="true"
          className="h-7 w-12 rounded-full bg-line-strong transition-colors duration-150 peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 size-6 rounded-full bg-surface shadow-soft transition-transform duration-150 peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}
