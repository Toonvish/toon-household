import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { buttonClasses } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";

/**
 * The calendar's screen heading (as finance's `PageHeader`, ADR 0010): on phones the shell's `PhoneHeaderRow`
 * (household and module chips, ONE action) comes first; from `lg` the title row carries the actions on the right.
 *
 * The manifest graph never imports this file (`HomeCard.tsx` neither): screens are lazy, so `PhoneHeaderRow`
 * stays outside the manifest's static imports.
 */
export interface CalendarPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** The one header action (the `+ Neu` link on every tab screen, design §4.1). */
  actions?: ReactNode;
  /** A back link above the title. */
  above?: ReactNode;
  className?: string;
}

export function CalendarPageHeader({ title, description, actions, above, className }: CalendarPageHeaderProps) {
  return (
    <div className={cn("mb-4 flex flex-col gap-3 sm:mb-6", className)}>
      <PhoneHeaderRow action={actions} />
      {above}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">{title}</h1>
          {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="hidden shrink-0 flex-wrap gap-2 lg:flex">{actions}</div> : null}
      </div>
    </div>
  );
}

/** `+ Neu`: opens `/calendar/new`, with the day (and kind) preselected (design §4.1). */
export function NewEntryLink({ date, kind }: { date?: string | undefined; kind?: "event" | "task" | "car" | undefined }) {
  const t = useT();
  return (
    <AppLink
      to="/calendar/new"
      search={{ date, kind }}
      className={buttonClasses({ variant: "primary", size: "sm" })}
      aria-label={t("calendar.common.newEntry")}
    >
      <Plus aria-hidden="true" className="size-4" />
      {t("calendar.common.new")}
    </AppLink>
  );
}

/** A back link above a title. */
export function BackLink({ to, search, label }: { to: string; search?: Record<string, string | undefined>; label: string }) {
  return (
    <AppLink to={to} search={search} className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-brand hover:underline">
      {label}
    </AppLink>
  );
}
