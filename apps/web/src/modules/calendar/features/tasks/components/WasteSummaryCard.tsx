import { useQuery } from "@tanstack/react-query";
import { WASTE_PROVIDERS } from "@toon/shared";
import { Trash2 } from "lucide-react";
import { Card, Skeleton, buttonClasses } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { PickupList } from "@/modules/calendar/components/PickupList";
import { wasteQuery } from "@/modules/calendar/lib/queries";

/**
 * The waste card of the tasks screen (design §4.4): the next pickup per waste type with its dot and date, the
 * tour, and a change link; before the first setup a short explainer and a set-up link. The phone's way to the
 * waste screen (design §4.1).
 */
export function WasteSummaryCard({ householdId, today }: { householdId: string; today: string }) {
  const t = useT();
  const query = useQuery(wasteQuery(householdId, today));
  const settings = query.data?.settings ?? null;
  return (
    <Card as="section" aria-labelledby="calendar-tasks-waste" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
          <Trash2 className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id="calendar-tasks-waste" className="font-display text-display-md font-medium text-fg">
            {t("calendar.tasks.waste")}
          </h2>
          {settings !== null ? (
            <p className="text-sm text-fg-muted">
              {WASTE_PROVIDERS[settings.provider].name} · {t("calendar.waste.next.tour", { tour: settings.tour })}
            </p>
          ) : null}
        </div>
      </div>
      {query.isPending ? (
        <Skeleton lines={3} />
      ) : settings === null ? (
        <p className="text-sm text-fg-muted">{t("calendar.waste.next.explainer")}</p>
      ) : query.data !== undefined && query.data.next.length > 0 ? (
        <PickupList pickups={query.data.next} today={today} />
      ) : (
        <p className="text-sm text-fg-muted">{t("calendar.waste.next.empty")}</p>
      )}
      <AppLink to="/calendar/waste" className={buttonClasses({ variant: settings === null ? "primary" : "secondary", size: "sm", className: "self-start" })}>
        {settings === null ? t("calendar.waste.next.setup") : t("calendar.waste.next.change")}
      </AppLink>
    </Card>
  );
}
