import type { ReactNode } from "react";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { cn } from "@/lib/cn";

/**
 * The finance module's screen heading (F `components/layout/AppShell.tsx` `PageHeader`, restyled
 * onto the design system per M3 Table R). On phones the shell's `PhoneHeaderRow` (household and
 * module chips, one action) comes first; from `lg` the title row carries the actions on the right.
 *
 * Header comment for the M3 import rule: the manifest, `HomeCard` and the settings section must
 * never import this file. Screens are lazy, so `PhoneHeaderRow` stays outside the manifest graph.
 */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right (desktop) / in the phone row (mobile). AT MOST one `ActionMenu`, never a row of icon buttons (docs/spec.md §4.10). */
  actions?: ReactNode;
  /** Back link / breadcrumb slot above the title. */
  above?: ReactNode;
  className?: string;
}

/** Consistent screen heading: `<PageHeader title={t("finance.plan.title")} actions={<ActionMenu … />} />`. */
export function PageHeader({ title, description, actions, above, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-4 flex flex-col gap-3 sm:mb-6", className)}>
      <PhoneHeaderRow action={actions} />
      {above}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">
            {title}
          </h1>
          {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="hidden shrink-0 flex-wrap gap-2 lg:flex">{actions}</div> : null}
      </div>
    </div>
  );
}
