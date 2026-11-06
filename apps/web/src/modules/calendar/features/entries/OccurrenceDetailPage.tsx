/**
 * An occurrence's detail (`/calendar/entries/$entryId?date=`, design §4.1): the series with THIS occurrence's date,
 * people and state. `date` selects the occurrence; without one (or with a day the series does not have) the next
 * occurrence from today is shown, else the first. Actions: done / reopen (tasks), skip / unskip (any kind, plan m8
 * P12), Bearbeiten, Löschen (the whole series). An imported waste entry is changed under Müllabfuhr (P8): it keeps
 * its tick, its note and its assignee here.
 */
import { useQuery } from "@tanstack/react-query";
import { isCalendarDate, nextOccurrences, occurrenceOrdinal, type CalendarEntry } from "@toon/shared";
import { Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, ConfirmDialog, ErrorState, Skeleton, buttonClasses, useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink, useAppNavigate, useRouteParam } from "@/lib/nav";
import { useSearchParams } from "@/lib/navigation";
import { useCanMutate } from "@/lib/session";
import { BackLink, CalendarPageHeader } from "@/modules/calendar/components/CalendarPageHeader";
import { PersonDot } from "@/modules/calendar/components/PersonDot";
import { WasteDot } from "@/modules/calendar/components/WasteDot";
import { entryTitle, formatShortDate, formatWhen } from "@/modules/calendar/lib/format";
import { useCalendarContext, useCalendarMembers, useCars, useOccurrenceToggle } from "@/modules/calendar/lib/hooks";
import { memberMap, memberName, type MemberMap } from "@/modules/calendar/lib/people";
import { entryQuery, occurrencesQuery, useDeleteEntry } from "@/modules/calendar/lib/queries";
import { rhythmLabel, rotationPick, seriesOf } from "@/modules/calendar/lib/rhythm";
import { occurrenceEnd } from "./lib/form";

/** The occurrence a detail shows: the asked one when it exists, else the next from today, else the first. */
function pickDate(entry: CalendarEntry, asked: string | undefined, today: string): { date: string; askedMissing: boolean } {
  const series = seriesOf(entry);
  if (asked !== undefined && isCalendarDate(asked) && occurrenceOrdinal(series, asked) !== null) {
    return { date: asked, askedMissing: false };
  }
  const next = nextOccurrences(series, today, 1)[0]?.date ?? entry.startDate;
  return { date: next, askedMissing: asked !== undefined };
}

export function OccurrenceDetailPage() {
  const t = useT();
  const toast = useToast();
  const navigate = useAppNavigate();
  const search = useSearchParams();
  const entryId = useRouteParam("entryId") ?? "";
  const { householdId, userId, today } = useCalendarContext();
  const { canToggle, onToggle } = useOccurrenceToggle(householdId, userId);
  const { canMutate, reason } = useCanMutate();
  const { carNames } = useCars(householdId);
  const { members: householdMembers } = useCalendarMembers(householdId);
  const remove = useDeleteEntry(householdId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const query = useQuery(entryQuery(householdId, entryId));
  const picked = query.data ? pickDate(query.data, search.date, today) : null;
  const date = picked?.date ?? today;
  const occurrences = useQuery({ ...occurrencesQuery(householdId, date, date), enabled: query.data !== undefined });
  const occurrence = occurrences.data?.items.find((item) => item.id === `${entryId}:${date}`);
  const members: MemberMap = memberMap(occurrences.data?.members ?? householdMembers);

  const back = <BackLink to="/calendar" label={t("calendar.common.back")} />;

  if (query.isPending) {
    return (
      <div className="flex flex-col">
        <CalendarPageHeader title={t("calendar.module.name")} above={back} />
        <Skeleton lines={5} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col">
        <CalendarPageHeader title={t("calendar.module.name")} above={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const entry = query.data;
  const title = entryTitle(entry);
  const imported = entry.wasteImportId !== null;
  const status = occurrence?.status ?? "open";
  const ordinal = occurrenceOrdinal(seriesOf(entry), date) ?? 0;
  const assigneeId =
    occurrence?.assigneeId ??
    (entry.assigneeMode === "rotate"
      ? rotationPick(entry.assigneeIds, ordinal)
      : entry.assigneeMode === "fixed"
        ? (entry.assigneeIds[0] ?? null)
        : null);

  function setStatus(next: "done" | "skipped" | null) {
    onToggle({ entryId, date, status: next });
  }

  function deleteSeries() {
    remove.mutate(entryId, {
      onSuccess: () => {
        toast.success(t("calendar.entries.toast.deleted"));
        navigate({ to: "/calendar", replace: true });
      },
      onError: (error) => toast.fromError(error),
    });
  }

  const editLink = (
    <AppLink
      to="/calendar/entries/$entryId/edit"
      params={{ entryId }}
      className={buttonClasses({ variant: "secondary", size: "sm" })}
    >
      <Pencil aria-hidden="true" className="size-4" />
      {t("calendar.common.edit")}
    </AppLink>
  );

  return (
    <div className="flex flex-col">
      <CalendarPageHeader title={title} above={back} actions={canMutate ? editLink : undefined} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {picked?.askedMissing ? <p className="text-sm text-warning-soft-fg">{t("calendar.entries.detail.notOnThisDay")}</p> : null}
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Item label={t("calendar.entries.detail.when")}>
              {formatShortDate(date, today)}
              {" · "}
              {formatWhen({ date, endDate: occurrenceEnd(entry, date), allDay: entry.allDay, startTime: entry.startTime, endTime: entry.endTime }, today)}
            </Item>
            {entry.repeat.freq !== "none" ? (
              <Item label={t("calendar.entries.detail.rhythm")}>{rhythmLabel(entry.repeat, entry.startDate, today)}</Item>
            ) : null}
            {entry.kind === "task" ? (
              <Item label={t("calendar.entries.detail.assignee")}>
                {assigneeId === null ? t("calendar.common.nobody") : <Person id={assigneeId} members={members} />}
              </Item>
            ) : (
              <Item label={t("calendar.entries.detail.people")}>
                {entry.attendeeIds.length === 0
                  ? t("calendar.common.everybody")
                  : entry.attendeeIds.map((id) => <Person key={id} id={id} members={members} />)}
              </Item>
            )}
            {entry.resourceId !== null ? (
              <Item label={t("calendar.entries.detail.car")}>{carNames.get(entry.resourceId) ?? ""}</Item>
            ) : null}
            {entry.location ? <Item label={t("calendar.entries.detail.location")}>{entry.location}</Item> : null}
            {entry.notes ? (
              <Item label={t("calendar.entries.detail.notes")} wide>
                <span className="whitespace-pre-wrap">{entry.notes}</span>
              </Item>
            ) : null}
            <Item label={t("calendar.entries.detail.status")}>
              <Badge variant={status === "done" ? "success" : "neutral"}>
                {status === "done"
                  ? t("calendar.common.status.done")
                  : status === "skipped"
                    ? t("calendar.common.status.skipped")
                    : t("calendar.entries.detail.statusOpen")}
              </Badge>
              {status === "done" && occurrence?.doneBy ? (
                <span className="ml-2 text-sm text-fg-muted">
                  {t("calendar.common.doneBy", { name: memberName(members, occurrence.doneBy) })}
                </span>
              ) : null}
            </Item>
          </dl>

          {imported ? (
            <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-3 text-sm text-fg-muted">
              <p className="flex items-center gap-2">
                {entry.category ? <WasteDot category={entry.category} /> : null}
                {t("calendar.entries.detail.imported")}
              </p>
              <AppLink to="/calendar/waste" className="self-start font-semibold text-brand hover:underline">
                {t("calendar.entries.detail.toWaste")}
              </AppLink>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          {entry.kind === "task" ? (
            <Button
              variant={status === "done" ? "secondary" : "primary"}
              disabled={!canToggle || status === "skipped"}
              title={reason}
              onClick={() => setStatus(status === "done" ? null : "done")}
            >
              {status === "done" ? t("calendar.entries.detail.reopen") : t("calendar.entries.detail.markDone")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={!canToggle || status === "done"}
            title={reason}
            onClick={() => setStatus(status === "skipped" ? null : "skipped")}
          >
            {status === "skipped" ? t("calendar.entries.detail.unskip") : t("calendar.entries.detail.skip")}
          </Button>
          {imported ? null : (
            <Button
              variant="ghost"
              className="text-danger"
              leftIcon={<Trash2 className="size-4" />}
              disabled={!canMutate}
              title={reason}
              onClick={() => setConfirmDelete(true)}
            >
              {t("calendar.entries.detail.delete")}
            </Button>
          )}
          {reason ? <p className="text-sm text-fg-muted">{reason}</p> : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteSeries}
        title={t("calendar.entries.detail.deleteConfirm", { title })}
        description={entry.repeat.freq !== "none" ? t("calendar.entries.detail.deleteSeries") : undefined}
        confirmLabel={t("calendar.common.delete")}
        cancelLabel={t("calendar.common.cancel")}
        destructive
      />
    </div>
  );
}

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-3" : undefined}>
      <dt className="eyebrow text-fg-faint">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 break-words text-fg">{children}</dd>
    </div>
  );
}

function Person({ id, members }: { id: string; members: MemberMap }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PersonDot colorIndex={members.get(id)?.colorIndex ?? 1} />
      {memberName(members, id)}
    </span>
  );
}
