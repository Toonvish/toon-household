import {
  PutCalendarWasteSettingsRequestSchema,
  WASTE_PROVIDERS,
  type CalendarAssigneeMode,
  type CalendarMember,
  type CalendarWasteSettings,
} from "@toon/shared";
import { useState, type FormEvent } from "react";
import { Button, Card, Select, useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { usePutWasteSettings } from "@/modules/calendar/lib/queries";
import { AssigneeFields } from "@/modules/calendar/features/entries/components/WhoFields";

/** The tours a flyer prints (design §5.1). */
export const TOURS = WASTE_PROVIDERS.hattingen.tours;

/**
 * The waste settings (design §5, plan m8 P15): the provider (Stadt Hattingen), the tour ("Bezirk") of the street,
 * and who puts the bins out: nobody, one person, or taking turns per pickup day. Saving re-assigns every pickup
 * from the client's today on.
 */
export function WasteSettingsForm({
  householdId,
  today,
  settings,
  members,
  tour,
  onTourChange,
  canMutate,
  reason,
}: {
  householdId: string;
  today: string;
  settings: CalendarWasteSettings | null;
  members: ReadonlyArray<CalendarMember>;
  /** The tour is shared with the import dialog (the page holds it). */
  tour: string;
  onTourChange: (tour: string) => void;
  canMutate: boolean;
  reason?: string | undefined;
}) {
  const t = useT();
  const toast = useToast();
  const save = usePutWasteSettings(householdId);
  const [mode, setMode] = useState<CalendarAssigneeMode>(settings?.assigneeMode ?? "none");
  const [ids, setIds] = useState<string[]>(settings?.assigneeIds ?? []);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validate(PutCalendarWasteSettingsRequestSchema, {
      provider: "hattingen",
      tour: tour === "" ? Number.NaN : Number(tour),
      assigneeMode: mode,
      assigneeIds: ids,
      today,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.data, {
      onSuccess: () => toast.success(t("calendar.waste.settings.saved")),
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <Card as="section" aria-labelledby="calendar-waste-settings" className="flex min-w-0 flex-col gap-4">
      <h2 id="calendar-waste-settings" className="font-display text-display-md font-medium text-fg">
        {t("calendar.waste.settings.title")}
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors._form ? <p className="text-sm text-danger">{errors._form}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-fg">{t("calendar.waste.settings.provider")}</p>
            <p className="flex min-h-11 items-center text-fg">{WASTE_PROVIDERS.hattingen.name}</p>
          </div>
          <Select
            label={t("calendar.waste.settings.tour")}
            value={tour}
            placeholder={t("calendar.entries.who.pick")}
            onChange={(event) => onTourChange(event.target.value)}
            options={TOURS.map((value) => ({ value: String(value), label: t("calendar.waste.settings.tourOption", { tour: value }) }))}
            error={errors.tour}
          />
        </div>
        <p className="text-sm text-fg-muted">{t("calendar.waste.settings.tourHint")}</p>
        <AssigneeFields
          label={t("calendar.waste.settings.who")}
          hint={t("calendar.waste.settings.whoHint")}
          mode={mode}
          ids={ids}
          members={members}
          error={errors.assigneeIds ?? errors.assigneeMode}
          onChange={(nextMode, nextIds) => {
            setMode(nextMode);
            setIds(nextIds);
          }}
        />
        <Button type="submit" className="self-start" loading={save.isPending} disabled={!canMutate} title={reason}>
          {t("calendar.waste.settings.save")}
        </Button>
      </form>
    </Card>
  );
}
