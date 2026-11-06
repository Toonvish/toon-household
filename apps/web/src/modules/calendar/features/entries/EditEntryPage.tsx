/**
 * Bearbeiten (`/calendar/entries/$entryId/edit`, design §4.5; plan m8 P7, P8): the stored series as a draft, the
 * kind fixed; the PATCH carries every field but `kind` and the server validates the merged entry. An imported
 * waste entry edits only its note and who puts the bin out.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ConfirmDialog, ErrorState, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useRouteParam } from "@/lib/nav";
import { useCanMutate } from "@/lib/session";
import { BackLink, CalendarPageHeader } from "@/modules/calendar/components/CalendarPageHeader";
import { entryTitle } from "@/modules/calendar/lib/format";
import { useCalendarContext, useCalendarMembers, useCars } from "@/modules/calendar/lib/hooks";
import { memberMap } from "@/modules/calendar/lib/people";
import { entryQuery, useUpdateEntry } from "@/modules/calendar/lib/queries";
import { CarConflictNotice } from "./components/CarConflictNotice";
import { EntryForm } from "./components/EntryForm";
import { formStateFromEntry, toUpdateBody, withSaveContext } from "./lib/form";
import { useEntryEditor } from "./lib/use-entry-submit";

export function EditEntryPage() {
  const t = useT();
  const entryId = useRouteParam("entryId") ?? "";
  const { householdId, today } = useCalendarContext();
  const query = useQuery(entryQuery(householdId, entryId));
  const { members } = useCalendarMembers(householdId);
  const { cars } = useCars(householdId);
  const { canMutate, reason } = useCanMutate();
  const update = useUpdateEntry(householdId);
  const imported = query.data?.wasteImportId != null;

  const editor = useEntryEditor({
    initial: null,
    pending: update.isPending,
    skipDraftCheck: imported,
    send: ({ state, allowConflict }, callbacks) => {
      update.mutate({ entryId, body: withSaveContext(toUpdateBody(state, imported), state.kind, today, allowConflict) }, callbacks);
    },
    successMessage: t("calendar.entries.toast.saved"),
    destination: (entry) => ({ to: "/calendar/entries/$entryId", params: { entryId: entry.id } }),
  });
  const { initialise } = editor;

  useEffect(() => {
    if (query.data && editor.state === null) initialise(formStateFromEntry(query.data));
  }, [query.data, editor.state, initialise]);

  const header = (title: string) => (
    <CalendarPageHeader
      title={title}
      above={<BackLink to="/calendar/entries/$entryId" params={{ entryId }} label={t("calendar.common.back")} />}
    />
  );

  if (query.isPending || (query.data && editor.state === null)) {
    return (
      <div className="flex flex-col">
        {header(t("calendar.entries.edit.title"))}
        <Skeleton lines={6} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col">
        {header(t("calendar.entries.edit.title"))}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  const state = editor.state;
  if (state === null) return null;
  // An archived car still shows for a booking that uses it.
  const pickable = cars.filter((car) => !car.archived || car.id === state.resourceId);
  const carName = cars.find((car) => car.id === state.resourceId)?.name ?? "";

  return (
    <div className="flex flex-1 flex-col">
      {header(imported ? entryTitle(query.data) : t("calendar.entries.edit.title"))}
      <EntryForm
        state={state}
        onChange={editor.setState}
        errors={editor.errors}
        kindLocked
        imported={imported}
        members={members}
        cars={pickable}
        today={today}
        submitLabel={t("calendar.entries.submit.save")}
        pending={update.isPending}
        disabled={!canMutate}
        disabledReason={reason}
        notice={
          editor.conflicts ? (
            <CarConflictNotice
              conflicts={editor.conflicts}
              carName={carName}
              members={memberMap(members)}
              today={today}
              pending={update.isPending}
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

