/**
 * The waste screen (`/calendar/waste`, design §5, plan m8 P15-P17, P20): the settings (Stadt Hattingen, the tour of the
 * street, who puts the bins out), the import of the city's flyer (by URL or as an uploaded PDF, with a preview),
 * the imports, and the next pickup per type. The header action opens the import.
 */
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, ErrorState, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useCanMutate } from "@/lib/session";
import { CalendarPageHeader } from "@/modules/calendar/components/CalendarPageHeader";
import { PickupList } from "@/modules/calendar/components/PickupList";
import { useCalendarContext, useCalendarMembers } from "@/modules/calendar/lib/hooks";
import { wasteQuery } from "@/modules/calendar/lib/queries";
import { WasteImportDialog, initialWasteUrl } from "./components/WasteImportDialog";
import { WasteImportList } from "./components/WasteImportList";
import { WasteSettingsForm } from "./components/WasteSettingsForm";

export function WastePage() {
  const t = useT();
  const { householdId, today } = useCalendarContext();
  const { canMutate, reason } = useCanMutate();
  const { members } = useCalendarMembers(householdId);
  const query = useQuery(wasteQuery(householdId, today));
  const [importOpen, setImportOpen] = useState(false);
  const [tour, setTour] = useState("");
  const settings = query.data?.settings ?? null;

  // The tour starts at the saved one once the overview has loaded (an edit in progress is kept).
  useEffect(() => {
    if (settings !== null) setTour((current) => (current === "" ? String(settings.tour) : current));
  }, [settings]);

  const action = (
    <Button size="sm" leftIcon={<Upload className="size-4" />} disabled={!canMutate} title={reason} onClick={() => setImportOpen(true)}>
      {t("calendar.waste.import.open")}
    </Button>
  );

  return (
    <div className="flex flex-col">
      <CalendarPageHeader title={t("calendar.waste.title")} description={t("calendar.waste.description")} actions={action} />
      {query.isPending ? (
        <Skeleton lines={6} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            <WasteSettingsForm
              key={settings?.updatedAt ?? "new"}
              householdId={householdId}
              today={today}
              settings={settings}
              members={members}
              tour={tour}
              onTourChange={setTour}
              canMutate={canMutate}
              reason={reason}
            />
            <WasteImportList householdId={householdId} imports={query.data.imports} canMutate={canMutate} />
          </div>
          <Card as="section" aria-labelledby="calendar-waste-next" className="flex h-fit min-w-0 flex-col gap-3">
            <h2 id="calendar-waste-next" className="font-display text-display-md font-medium text-fg">
              {t("calendar.waste.next.title")}
            </h2>
            {settings === null ? (
              <p className="text-sm text-fg-muted">{t("calendar.waste.next.explainer")}</p>
            ) : query.data.next.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("calendar.waste.next.empty")}</p>
            ) : (
              <PickupList pickups={query.data.next} today={today} />
            )}
          </Card>
        </div>
      )}
      {importOpen ? (
        <WasteImportDialog
          open
          onClose={() => setImportOpen(false)}
          householdId={householdId}
          today={today}
          initialTour={tour}
          initialUrl={initialWasteUrl(settings?.sourceUrl)}
          imports={query.data?.imports ?? []}
        />
      ) : null}
    </div>
  );
}
