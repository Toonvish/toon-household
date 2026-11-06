import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { PickupList } from "@/modules/calendar/components/PickupList";
import { wasteQuery } from "@/modules/calendar/lib/queries";

/** The desktop rail's next pickups (design §4.2): the next date per waste type, or the way to set it up. */
export function NextPickupsCard({ householdId, today }: { householdId: string; today: string }) {
  const t = useT();
  const query = useQuery(wasteQuery(householdId, today));
  const configured = query.data?.settings !== null && query.data?.settings !== undefined;
  return (
    <Card as="section" aria-labelledby="calendar-pickups-card" className="flex min-w-0 flex-col gap-3">
      <h2 id="calendar-pickups-card" className="font-display text-display-sm font-medium text-fg">
        {t("calendar.agenda.pickups.title")}
      </h2>
      {query.isPending ? (
        <Skeleton lines={3} />
      ) : query.data === undefined ? null : !configured ? (
        <p className="text-sm text-fg-muted">{t("calendar.waste.next.explainer")}</p>
      ) : query.data.next.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("calendar.waste.next.empty")}</p>
      ) : (
        <PickupList pickups={query.data.next} today={today} />
      )}
      <AppLink to="/calendar/waste" className="self-start text-sm font-semibold text-brand hover:underline">
        {configured ? t("calendar.waste.next.change") : t("calendar.waste.next.setup")}
      </AppLink>
    </Card>
  );
}
