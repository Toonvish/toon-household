import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { FieldShell, useControlAria } from "./Field";

/**
 * Shared by Input, Select and Textarea.
 *
 * `min-w-0` is load-bearing, not cosmetic. A form control has an intrinsic width of
 * roughly 20 characters (~200px with our padding), and a flex/grid item's automatic
 * minimum size is its content's min-content width — so `w-full` alone does NOT let a
 * control shrink. Two side-by-side fields in a `grid-cols-2` therefore demanded
 * ~412px and pushed their card wider than a 390px phone. `min-w-0` drops that
 * minimum to zero so the container decides the width, which is what `w-full` implies.
 */
export const controlClasses =
  "w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-fg " +
  "placeholder:text-fg-subtle transition-colors duration-150 " +
  "focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/40 " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:outline-danger/40";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  /** Small icon rendered inside the field on the left. */
  leftIcon?: ReactNode;
  /** Element rendered inside the field on the right (e.g. a unit). */
  rightSlot?: ReactNode;
  /**
   * `md` (default) is today's `min-h-11` field. `lg` is `min-h-13`, for the
   * design's 52/54px add bar and search field — `rightSlot`'s own padding
   * follows this so a `--brand` submit block inside the field never overlaps
   * the text.
   */
  size?: "md" | "lg";
  className?: string;
  /** Class list for the outer wrapper. */
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    optional,
    leftIcon,
    rightSlot,
    size = "md",
    className,
    containerClassName,
    id: idProp,
    required,
    type = "text",
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
        {leftIcon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-subtle [&_svg]:size-5"
          >
            {leftIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          type={type}
          required={required}
          {...aria}
          className={cn(
            controlClasses,
            size === "lg" ? "min-h-13" : "min-h-11",
            leftIcon && "pl-11",
            rightSlot && (size === "lg" ? "pr-14" : "pr-11"),
            className,
          )}
          {...rest}
        />
        {rightSlot ? (
          <span className="absolute inset-y-0 right-2 flex items-center text-fg-subtle">
            {rightSlot}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
});

export type PasswordInputProps = Omit<InputProps, "type" | "rightSlot">;

/** Password field with a show/hide toggle (44px target). */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(props, ref) {
    const t = useT();
    const [visible, setVisible] = useState(false);
    const toggleLabel = visible ? t("common.passwordInput.hide") : t("common.passwordInput.show");
    return (
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        rightSlot={
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={toggleLabel}
            title={toggleLabel}
            className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {visible ? (
              <EyeOff className="size-5" aria-hidden="true" />
            ) : (
              <Eye className="size-5" aria-hidden="true" />
            )}
          </button>
        }
        {...props}
      />
    );
  },
);
