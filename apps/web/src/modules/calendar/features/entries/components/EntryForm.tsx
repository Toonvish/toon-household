import type { CalendarMember, CalendarResource } from "@toon/shared";
import type { FormEvent, ReactNode } from "react";
import { Button, Input, Switch, Tabs, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { ENTRY_KINDS, errorAt, withKind, type EntryFormState } from "../lib/form";
import { RepeatFields } from "./RepeatFields";
import { AssigneeFields, WhoFields } from "./WhoFields";

/**
 * Neu / Bearbeiten (design §4.5): the segmented control Termin · Aufgabe · Auto (fixed on edit), Titel,
 * all-day, date and times, repeat, who, location, note. An imported waste entry shows only its note
 * and who puts the bin out (plan m8 P8). The page owns the state, the submit and the navigation guard; `notice`
 * is the conflict answer above the submit bar.
 */
export function EntryForm({
  state,
  onChange,
  errors,
  kindLocked,
  imported,
  members,
  cars,
  today,
  submitLabel,
  pending,
  disabled,
  disabledReason,
  notice,
  onSubmit,
}: {
  state: EntryFormState;
  onChange: (next: EntryFormState) => void;
  errors: Readonly<Record<string, string>>;
  kindLocked: boolean;
  imported: boolean;
  members: ReadonlyArray<CalendarMember>;
  cars: ReadonlyArray<CalendarResource>;
  today: string;
  submitLabel: string;
  pending: boolean;
  disabled: boolean;
  disabledReason?: string | undefined;
  notice?: ReactNode;
  onSubmit: () => void;
}) {
  const t = useT();
  const patch = (next: Partial<EntryFormState>) => onChange({ ...state, ...next });

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-5">
      {errors._form ? (
        <p role="alert" className="rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-fg">
          {errors._form}
        </p>
      ) : null}

      {imported ? (
        <AssigneeFields
          label={t("calendar.waste.settings.who")}
          mode={state.assigneeMode}
          ids={state.assigneeIds}
          members={members}
          error={errorAt(errors, "assigneeIds")}
          onChange={(assigneeMode, assigneeIds) => patch({ assigneeMode, assigneeIds })}
        />
      ) : (
        <>
          {kindLocked ? null : (
            <Tabs
              aria-label={t("calendar.entries.kind.label")}
              value={state.kind}
              onChange={(kind) => onChange(withKind(state, kind))}
              items={ENTRY_KINDS.map((kind) => ({ value: kind, label: t(`calendar.common.kind.${kind}`) }))}
            />
          )}

          <Input
            label={t("calendar.entries.field.title")}
            value={state.title}
            maxLength={200}
            onChange={(event) => patch({ title: event.target.value })}
            error={errorAt(errors, "title")}
            autoComplete="off"
          />

          <Switch
            label={t("calendar.entries.field.allDay")}
            checked={state.allDay}
            onChange={(allDay) => patch({ allDay, startTime: allDay ? "" : state.startTime || "09:00", endTime: allDay ? "" : state.endTime })}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t("calendar.entries.field.date")}
              type="date"
              value={state.startDate}
              onChange={(event) => patch({ startDate: event.target.value })}
              error={errorAt(errors, "startDate")}
            />
            {state.kind === "task" ? null : (
              <Input
                label={t("calendar.entries.field.endDate")}
                type="date"
                optional
                hint={t("calendar.entries.field.endDateHint")}
                value={state.endDate}
                min={state.startDate}
                onChange={(event) => patch({ endDate: event.target.value })}
                error={errorAt(errors, "endDate")}
              />
            )}
          </div>

          {state.allDay ? null : (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t("calendar.entries.field.startTime")}
                type="time"
                value={state.startTime}
                onChange={(event) => patch({ startTime: event.target.value })}
                error={errorAt(errors, "startTime")}
              />
              <Input
                label={t("calendar.entries.field.endTime")}
                type="time"
                optional={state.kind !== "car"}
                value={state.endTime}
                onChange={(event) => patch({ endTime: event.target.value })}
                error={errorAt(errors, "endTime")}
              />
            </div>
          )}

          <RepeatFields state={state} today={today} errors={errors} onChange={patch} />

          <WhoFields state={state} members={members} cars={cars} errors={errors} onChange={patch} />

          <Input
            label={t("calendar.entries.field.location")}
            optional
            value={state.location}
            maxLength={200}
            onChange={(event) => patch({ location: event.target.value })}
            error={errorAt(errors, "location")}
          />
        </>
      )}

      <Textarea
        label={t("calendar.entries.field.notes")}
        optional
        value={state.notes}
        maxLength={2000}
        autoGrow
        onChange={(event) => patch({ notes: event.target.value })}
        error={errorAt(errors, "notes")}
      />

      {notice}

      <div className="flex-1" />

      <div className="sticky bottom-tabbar z-20 -mb-4 bleed-gutter-inset border-t border-line bg-bg/95 py-3 backdrop-blur-sm">
        <Button type="submit" fullWidth loading={pending} disabled={disabled} title={disabledReason}>
          {submitLabel}
        </Button>
        {disabledReason ? <p className="pt-2 text-center text-sm text-fg-muted">{disabledReason}</p> : null}
      </div>
    </form>
  );
}
