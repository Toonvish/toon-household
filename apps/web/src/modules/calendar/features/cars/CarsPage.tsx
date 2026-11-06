/**
 * Autos (`/calendar/cars`, design §4.1; plan m8 P13): the household's cars with their bookings of the next 30
 * days, adding a car, renaming, archiving / restoring, and deleting one nobody ever booked (a booked car answers
 * `409 calendar_resource_in_use`: archive it instead). The header action books a car.
 */
import { useQuery } from "@tanstack/react-query";
import {
  CreateCalendarResourceRequestSchema,
  addCalendarDays,
  type CalendarOccurrence,
  type CalendarResource,
} from "@toon/shared";
import { Archive, ArchiveRestore, Car, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  useToast,
} from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { useCanMutate } from "@/lib/session";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { CalendarPageHeader, NewEntryLink } from "@/modules/calendar/components/CalendarPageHeader";
import { isApiError } from "@/modules/calendar/lib/api";
import { formatShortDate, formatTimeRange } from "@/modules/calendar/lib/format";
import { useCalendarContext } from "@/modules/calendar/lib/hooks";
import { memberMap, memberName, type MemberMap } from "@/modules/calendar/lib/people";
import {
  occurrencesQuery,
  resourcesQuery,
  useCreateResource,
  useDeleteResource,
  useUpdateResource,
} from "@/modules/calendar/lib/queries";

/** Bookings are listed this many days ahead (today included). */
const UPCOMING_DAYS = 30;
/** At most this many bookings per car. */
const PER_CAR = 5;

export function CarsPage() {
  const t = useT();
  const { householdId, today } = useCalendarContext();
  const { canMutate, reason } = useCanMutate();
  const cars = useQuery(resourcesQuery(householdId, true));
  const bookings = useQuery(
    occurrencesQuery(householdId, today, addCalendarDays(today, UPCOMING_DAYS - 1), { kind: "car" }),
  );
  const members = useMemo(() => memberMap(bookings.data?.members ?? []), [bookings.data]);

  return (
    <div className="flex flex-col">
      <CalendarPageHeader
        title={t("calendar.cars.title")}
        description={t("calendar.cars.description")}
        actions={<NewEntryLink date={today} kind="car" />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          {cars.isPending ? (
            <Skeleton lines={4} />
          ) : cars.isError ? (
            <ErrorState error={cars.error} onRetry={() => void cars.refetch()} />
          ) : cars.data.items.length === 0 ? (
            <EmptyState icon={<Car />} title={t("calendar.cars.empty.title")} description={t("calendar.cars.empty.description")} />
          ) : (
            <ul className="flex flex-col gap-3">
              {cars.data.items.map((car) => (
                <li key={car.id}>
                  <CarCard
                    car={car}
                    householdId={householdId}
                    today={today}
                    bookings={(bookings.data?.items ?? []).filter((item) => item.resourceId === car.id)}
                    members={members}
                    canMutate={canMutate}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <AddCarForm householdId={householdId} canMutate={canMutate} reason={reason} />
      </div>
    </div>
  );
}

function AddCarForm({ householdId, canMutate, reason }: { householdId: string; canMutate: boolean; reason?: string | undefined }) {
  const t = useT();
  const toast = useToast();
  const create = useCreateResource(householdId);
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validate(CreateCalendarResourceRequestSchema, { name });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    create.mutate(result.data, {
      onSuccess: () => {
        setName("");
        toast.success(t("calendar.cars.toast.added"));
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <Card as="section" aria-labelledby="calendar-add-car" className="flex h-fit min-w-0 flex-col gap-3">
      <h2 id="calendar-add-car" className="font-display text-display-sm font-medium text-fg">
        {t("calendar.cars.add.label")}
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Input
          aria-label={t("calendar.cars.add.label")}
          placeholder={t("calendar.cars.add.placeholder")}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          error={errors.name ?? errors._form}
        />
        <Button type="submit" loading={create.isPending} disabled={!canMutate} title={reason}>
          {t("calendar.cars.add.submit")}
        </Button>
      </form>
    </Card>
  );
}

function CarCard({
  car,
  householdId,
  today,
  bookings,
  members,
  canMutate,
}: {
  car: CalendarResource;
  householdId: string;
  today: string;
  bookings: ReadonlyArray<CalendarOccurrence>;
  members: MemberMap;
  canMutate: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const update = useUpdateResource(householdId);
  const remove = useDeleteResource(householdId);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function setArchived(archived: boolean) {
    update.mutate(
      { resourceId: car.id, body: { archived } },
      { onSuccess: () => toast.success(t("calendar.cars.toast.saved")), onError: (error) => toast.fromError(error) },
    );
  }

  function deleteCar() {
    remove.mutate(car.id, {
      onSuccess: () => toast.success(t("calendar.cars.toast.deleted")),
      onError: (error) =>
        isApiError(error) && error.code === "calendar_resource_in_use"
          ? toast.error(t("calendar.cars.inUse"))
          : toast.fromError(error),
    });
  }

  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
          <Car className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-display-sm font-medium break-words text-fg">{car.name}</h2>
          {car.archived ? <Badge size="sm">{t("calendar.cars.archived")}</Badge> : null}
        </div>
        {canMutate ? (
          <ActionMenu
            label={t("calendar.cars.title")}
            items={[
              { label: t("calendar.cars.rename"), icon: <Pencil />, onSelect: () => setRenaming(true) },
              car.archived
                ? { label: t("calendar.cars.restore"), icon: <ArchiveRestore />, onSelect: () => setArchived(false) }
                : { label: t("calendar.cars.archive"), icon: <Archive />, onSelect: () => setArchived(true) },
              { label: t("calendar.cars.delete"), icon: <Trash2 />, variant: "danger", onSelect: () => setConfirmDelete(true) },
            ]}
          />
        ) : null}
      </div>

      {car.archived ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="eyebrow text-fg-faint">{t("calendar.cars.upcoming")}</p>
          {bookings.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("calendar.cars.noBookings")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {bookings.slice(0, PER_CAR).map((booking) => (
                <li key={booking.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                  <AppLink
                    to="/calendar/entries/$entryId"
                    params={{ entryId: booking.entryId }}
                    search={{ date: booking.date }}
                    className="font-medium text-fg tabular-nums hover:underline"
                  >
                    {formatShortDate(booking.date, today)}
                  </AppLink>
                  <span className="text-fg-muted tabular-nums">
                    {booking.allDay ? t("calendar.common.allDay") : formatTimeRange(booking.startTime, booking.endTime)}
                  </span>
                  <span className="min-w-0 break-words text-fg">
                    {booking.memberIds.map((id) => memberName(members, id)).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <RenameDialog open={renaming} car={car} householdId={householdId} onClose={() => setRenaming(false)} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteCar}
        title={t("calendar.cars.deleteConfirm", { name: car.name })}
        confirmLabel={t("calendar.cars.delete")}
        cancelLabel={t("calendar.common.cancel")}
        destructive
      />
    </Card>
  );
}

function RenameDialog({
  open,
  car,
  householdId,
  onClose,
}: {
  open: boolean;
  car: CalendarResource;
  householdId: string;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const update = useUpdateResource(householdId);
  const [name, setName] = useState(car.name);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validate(CreateCalendarResourceRequestSchema, { name });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    update.mutate(
      { resourceId: car.id, body: { name: result.data.name } },
      {
        onSuccess: () => {
          toast.success(t("calendar.cars.toast.saved"));
          onClose();
        },
        onError: (error) => setErrors(apiFieldErrors(error)),
      },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("calendar.cars.renameTitle")} variant="modal" size="sm">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          aria-label={t("calendar.cars.renameTitle")}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          error={errors.name ?? errors._form}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("calendar.common.cancel")}
          </Button>
          <Button type="submit" loading={update.isPending}>
            {t("calendar.common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
