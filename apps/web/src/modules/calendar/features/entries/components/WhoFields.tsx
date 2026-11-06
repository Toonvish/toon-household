import type { CalendarAssigneeMode, CalendarMember, CalendarResource } from "@toon/shared";
import { ChevronUp } from "lucide-react";
import { Chip, IconButton, Select, Tabs } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { PersonDot } from "@/modules/calendar/components/PersonDot";
import { errorAt, type EntryFormState } from "../lib/form";

/**
 * Wer (design §4.5): a Termin names members (none selected = "Alle"); an Aufgabe has Niemand · Eine Person ·
 * Abwechselnd (an ordered rotation); an Autobuchung picks the car and the one person who needs it.
 */
export function WhoFields({
  state,
  members,
  cars,
  errors,
  onChange,
}: {
  state: EntryFormState;
  members: ReadonlyArray<CalendarMember>;
  cars: ReadonlyArray<CalendarResource>;
  errors: Readonly<Record<string, string>>;
  onChange: (next: Partial<EntryFormState>) => void;
}) {
  const t = useT();

  if (state.kind === "event") {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm font-semibold text-fg">{t("calendar.entries.who.label")}</p>
        <div className="flex flex-wrap gap-2">
          {members.map((member) => {
            const selected = state.attendeeIds.includes(member.userId);
            return (
              <Chip
                key={member.userId}
                label={member.name}
                leadingIcon={<PersonDot colorIndex={member.colorIndex} />}
                selected={selected}
                onSelect={() =>
                  onChange({
                    attendeeIds: selected
                      ? state.attendeeIds.filter((id) => id !== member.userId)
                      : [...state.attendeeIds, member.userId],
                  })
                }
              />
            );
          })}
        </div>
        <FieldMessage error={errorAt(errors, "attendeeIds")} hint={t("calendar.entries.who.everybodyHint")} />
      </div>
    );
  }

  if (state.kind === "task") {
    return (
      <AssigneeFields
        label={t("calendar.entries.who.assignee")}
        mode={state.assigneeMode}
        ids={state.assigneeIds}
        members={members}
        error={errorAt(errors, "assigneeIds") ?? errorAt(errors, "assigneeMode")}
        onChange={(mode, ids) => onChange({ assigneeMode: mode, assigneeIds: ids })}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {cars.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("calendar.entries.car.none")}</p>
      ) : (
        <Select
          label={t("calendar.entries.car.label")}
          value={state.resourceId}
          placeholder={t("calendar.entries.who.pick")}
          onChange={(event) => onChange({ resourceId: event.target.value })}
          options={cars.map((car) => ({ value: car.id, label: car.name }))}
          error={errorAt(errors, "resourceId")}
        />
      )}
      <AppLink to="/calendar/cars" className="self-start text-sm font-semibold text-brand hover:underline">
        {t("calendar.entries.car.manage")}
      </AppLink>
      <Select
        label={t("calendar.entries.car.driver")}
        value={state.attendeeIds[0] ?? ""}
        placeholder={t("calendar.entries.who.pick")}
        onChange={(event) => onChange({ attendeeIds: event.target.value === "" ? [] : [event.target.value] })}
        options={members.map((member) => ({ value: member.userId, label: member.name }))}
        error={errorAt(errors, "attendeeIds")}
      />
    </div>
  );
}

const MODES = ["none", "fixed", "rotate"] as const satisfies ReadonlyArray<CalendarAssigneeMode>;

/**
 * Niemand · Eine Person · Abwechselnd with its people: one Select for a fixed person; for a rotation the members
 * are tapped in turn order and the order is shown with a "nach vorne" button. Shared by the task form and the
 * waste settings (who puts the bins out, plan m8 P15).
 */
export function AssigneeFields({
  label,
  hint,
  mode,
  ids,
  members,
  error,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  mode: CalendarAssigneeMode;
  ids: ReadonlyArray<string>;
  members: ReadonlyArray<CalendarMember>;
  error?: string | undefined;
  disabled?: boolean;
  onChange: (mode: CalendarAssigneeMode, ids: string[]) => void;
}) {
  const t = useT();
  const byId = new Map(members.map((member) => [member.userId, member]));

  function setMode(next: CalendarAssigneeMode) {
    if (next === "none") onChange("none", []);
    else if (next === "fixed") onChange("fixed", ids.slice(0, 1));
    else onChange("rotate", [...ids]);
  }

  function toggle(userId: string) {
    onChange("rotate", ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId]);
  }

  function moveUp(index: number) {
    if (index <= 0) return;
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(index - 1, 0, moved);
    onChange("rotate", next);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="pb-1.5 text-sm font-semibold text-fg">{label}</legend>
      <Tabs
        aria-label={label}
        value={mode}
        onChange={setMode}
        items={MODES.map((value) => ({ value, label: t(`calendar.entries.who.mode.${value}`), disabled }))}
      />
      {mode === "fixed" ? (
        <Select
          label={t("calendar.entries.who.person")}
          value={ids[0] ?? ""}
          placeholder={t("calendar.entries.who.pick")}
          onChange={(event) => onChange("fixed", event.target.value === "" ? [] : [event.target.value])}
          options={members.map((member) => ({ value: member.userId, label: member.name }))}
        />
      ) : null}
      {mode === "rotate" ? (
        <>
          <p className="text-sm text-fg-muted">{t("calendar.entries.who.rotationHint")}</p>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <Chip
                key={member.userId}
                label={member.name}
                leadingIcon={<PersonDot colorIndex={member.colorIndex} />}
                selected={ids.includes(member.userId)}
                onSelect={() => toggle(member.userId)}
                disabled={disabled}
              />
            ))}
          </div>
          {ids.length > 0 ? (
            <ol className="flex flex-col gap-1">
              {ids.map((id, index) => {
                const member = byId.get(id);
                const name = member?.name ?? t("calendar.common.formerMember");
                return (
                  <li key={id} className="flex min-w-0 items-center gap-2 text-sm text-fg">
                    <span className="w-5 shrink-0 text-right text-fg-muted tabular-nums">{index + 1}.</span>
                    <PersonDot colorIndex={member?.colorIndex ?? 1} />
                    <span className="min-w-0 flex-1 break-words">{name}</span>
                    {index > 0 ? (
                      <IconButton
                        label={t("calendar.entries.who.moveUp", { name })}
                        variant="ghost"
                        size="sm"
                        icon={<ChevronUp />}
                        onClick={() => moveUp(index)}
                        disabled={disabled}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </>
      ) : null}
      <FieldMessage error={error} hint={hint} />
    </fieldset>
  );
}

function FieldMessage({ error, hint }: { error?: string | undefined; hint?: string | undefined }) {
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (hint) return <p className="text-sm text-fg-muted">{hint}</p>;
  return null;
}
