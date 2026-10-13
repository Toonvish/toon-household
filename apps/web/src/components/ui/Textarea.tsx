import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { FieldShell, useControlAria } from "./Field";
import { controlClasses } from "./Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  /** Grows with the content up to `maxRows` (default: fixed `rows`). */
  autoGrow?: boolean;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    error,
    optional,
    autoGrow = false,
    className,
    containerClassName,
    id: idProp,
    required,
    rows = 4,
    onInput,
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
      <textarea
        ref={ref}
        rows={rows}
        required={required}
        {...aria}
        className={cn(controlClasses, "resize-y leading-relaxed", className)}
        onInput={(event) => {
          if (autoGrow) {
            const element = event.currentTarget;
            element.style.height = "auto";
            element.style.height = `${element.scrollHeight}px`;
          }
          onInput?.(event);
        }}
        {...rest}
      />
    </FieldShell>
  );
});
