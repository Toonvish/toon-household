/**
 * Neu (`/calendar/new?kind=&date=`, design §4.5): a fresh draft of the preselected kind and day; after the save the
 * occurrence's detail opens.
 */
import { useT } from "@/lib/i18n";
import { useSearchParams } from "@/lib/navigation";
import { useCanMutate } from "@/lib/session";
import { ConfirmDialog } from "@/components/ui";
import { BackLink, CalendarPageHeader } from "@/modules/calendar/components/CalendarPageHeader";
import { useCalendarContext, useCalendarMembers, useCars } from "@/modules/calendar/lib/hooks";
import { memberMap } from "@/modules/calendar/lib/people";
import { useCreateEntry } from "@/modules/calendar/lib/queries";
import { CarConflictNotice } from "./components/CarConflictNotice";
import { EntryForm } from "./components/EntryForm";
import { emptyFormState, isEntryKind, toCreateBody } from "./lib/form";
import { useEntryEditor } from "./lib/use-entry-submit";

export function NewEntryPage() {
  const t = useT();
  const search = useSearchParams();
  const { householdId, today } = useCalendarContext();
  const { members } = useCalendarMembers(householdId);
  const { activeCars } = useCars(householdId);
  const { canMutate, reason } = useCanMutate();
  const create = useCreateEntry(householdId);

  const editor = useEntryEditor({
    initial: emptyFormState(isEntryKind(search.kind) ? search.kind : "event", search.date, today),
    pending: create.isPending,
    send: ({ state, allowConflict }, callbacks) => {
      const body = toCreateBody(state);
      create.mutate(allowConflict ? { ...body, allowConflict: true } : body, callbacks);
    },
    successMessage: t("calendar.entries.toast.created"),
    destination: (entry) => ({ to: "/calendar/entries/$entryId", params: { entryId: entry.id }, search: { date: entry.startDate } }),
  });
  const state = editor.state;
  if (state === null) return null;
  const carName = activeCars.find((car) => car.id === state.resourceId)?.name ?? "";

  return (
    <div className="flex flex-1 flex-col">
      <CalendarPageHeader
        title={t("calendar.entries.new.title")}
        above={<BackLink to="/calendar" label={t("calendar.common.back")} />}
      />
      <EntryForm
        state={state}
        onChange={editor.setState}
        errors={editor.errors}
        kindLocked={false}
        imported={false}
        members={members}
        cars={activeCars}
        today={today}
        submitLabel={t("calendar.entries.submit.create")}
        pending={create.isPending}
        disabled={!canMutate}
        disabledReason={reason}
        notice={
          editor.conflicts ? (
            <CarConflictNotice
              conflicts={editor.conflicts}
              carName={carName}
              members={memberMap(members)}
              today={today}
              pending={create.isPending}
              onForce={() => editor.submit(true)}
            />
          ) : null
        }
        onSubmit={() => editor.submit(false)}
      />
      <ConfirmDialog
        open={editor.guard.blocked}
        onClose={() => editor.guard.reset()}
        onConfirm={() => editor.guard.proceed()}
        title={t("calendar.common.unsavedWarning")}
        confirmLabel={t("calendar.common.discard")}
        cancelLabel={t("calendar.common.cancel")}
        destructive
      />
    </div>
  );
}
