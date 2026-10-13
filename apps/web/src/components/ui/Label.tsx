import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Adds the "(optional)" hint instead of a required marker. */
  optional?: boolean;
  required?: boolean;
  children: ReactNode;
}

export function Label({ optional, required, className, children, ...rest }: LabelProps) {
  const t = useT();
  return (
    <label className={cn("block text-control font-medium text-fg", className)} {...rest}>
      {children}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
      {optional ? (
        <span className="ml-1 font-normal text-fg-subtle">{t("common.label.optional")}</span>
      ) : null}
    </label>
  );
}
