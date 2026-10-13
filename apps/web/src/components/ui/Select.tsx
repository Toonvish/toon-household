import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { FieldShell, useControlAria } from "./Field";
import { controlClasses } from "./Input";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "size"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  /** Options as data — native `<select>`, so mobile gets the OS picker. */
  options: readonly SelectOption[];
  /** Shown as a disabled first entry when the value is empty. */
  placeholder?: string;
  /** Mirrors `Input`'s `size` for symmetry — `md` (default, `min-h-11`) or `lg` (`min-h-13`). */
  size?: "md" | "lg";
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    hint,
    error,
    optional,
    options,
    placeholder,
    size = "md",
    className,
    containerClassName,
    id: idProp,
    required,
    ...rest
  },
  ref,
) {
  const aria = useControlAria(idProp, error, hint);

  return (
    <FieldShell
      id={aria.id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      optional={optional}
      className={containerClassName}
    >
      <div className="relative">
        <select
          ref={ref}
          required={required}
          {...aria}
          className={cn(
            controlClasses,
            size === "lg" ? "min-h-13" : "min-h-11",
            "appearance-none pr-10",
            className,
          )}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 my-auto size-5 text-fg-subtle"
        />
      </div>
    </FieldShell>
  );
});
