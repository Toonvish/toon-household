import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Label } from "./Label";

export interface FieldProps {
  label?: ReactNode;
  /** Helper text below the control. */
  hint?: ReactNode;
  /** Validation message — replaces the hint and colours the control. */
  error?: string | undefined;
  required?: boolean;
  optional?: boolean;
  className?: string;
  /**
   * Render function receiving the ids to wire up:
   * `<Field label="E-Mail">{(p) => <Input {...p} />}</Field>`
   */
  children: (props: ControlAria) => ReactNode;
}

/** The aria wiring a control has to spread onto itself. */
export interface ControlAria {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

/**
 * Resolves the control id and the aria attributes that depend on it.
 *
 * `useId` is called unconditionally (hook rules) and only used when the caller
 * passed no `id`.
 */
export function useControlAria(
  idProp: string | undefined,
  error: string | undefined,
  hint: ReactNode,
): ControlAria {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  return {
    id,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
    "aria-invalid": error ? true : undefined,
  };
}

export interface FieldShellProps {
  /** The control's id — the label's `htmlFor` and the message ids derive from it. */
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Label + control + hint/error, in the layout every form control here uses.
 *
 * Input, Select, Textarea and {@link Field} all render exactly this frame and
 * differ only in what sits between the label and the message — keeping four
 * copies is how the error paragraph's `role="alert"` or an id suffix silently
 * stops matching `aria-describedby` in one of them. NOT exported through
 * `components/ui/index.ts`: it is the shared body of the primitives, not a
 * primitive itself.
 */
export function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  optional,
  className,
  children,
}: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <Label htmlFor={id} required={required} optional={optional}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Label + control + hint/error with correct aria wiring.
 * Most screens can just use `<Input label=… error=… />`; use `Field` for custom controls.
 */
export function Field({ label, hint, error, required, optional, className, children }: FieldProps) {
  const aria = useControlAria(undefined, error, hint);
  return (
    <FieldShell
      id={aria.id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      optional={optional}
      className={className}
    >
      {children(aria)}
    </FieldShell>
  );
}
