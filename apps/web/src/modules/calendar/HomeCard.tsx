/**
 * The calendar module's card on Home (SPEC §5, design §4.7).
 *
 * FOUNDATION PLACEHOLDER (M8-T03): the module name linking to `/calendar`; the lane web (M8-T14) replaces it with
 * HEUTE and MORGEN, the "Heute Abend rausstellen" line and the two buttons.
 *
 * Static manifest graph: only `@/components/ui`, `@/lib/*` and lucide; never the module registry, the layout
 * components or the module's page header.
 */
import { CalendarDays } from "lucide-react";
import type { ReactElement } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";

export function CalendarHomeCard(): ReactElement {
  const t = useT();
  return (
    <Card as="section" aria-labelledby="home-card-calendar" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
        >
          <CalendarDays className="size-5" />
        </span>
        <h2 id="home-card-calendar" className="min-w-0 font-display text-display-md font-medium text-fg">
          <AppLink to="/calendar" className="hover:underline">
            {t("calendar.module.name")}
          </AppLink>
        </h2>
      </div>
    </Card>
  );
}
